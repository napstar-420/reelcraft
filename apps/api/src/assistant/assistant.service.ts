import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type {
  ApprovalPayload,
  AssistantItemDto,
  AssistantMode,
  AssistantPageContext,
  AssistantProviderDto,
  AssistantSessionDetailDto,
  AssistantSessionDto,
  AssistantStreamEvent,
  ChangePayload,
  CreateAssistantSessionDto,
  CreateBlueprintVersionDto,
  DecideApprovalDto,
  DecidePlanDto,
  PlanPayload,
  QuestionPayload,
  StartAssistantTurnDto,
  UpdateAssistantSessionDto,
  UpdateAssistantSettingsDto,
} from '@reelcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { assistantItem, assistantSession } from '../db/schema/index';
import { ulid } from '../common/ulid';
import { EngineConfig } from '../config/engine-config';
import { BlueprintService } from '../blueprint/blueprint.service';
import { CapabilityRegistry } from '../capability/capability.registry';
import { StyleRegistry } from '../capability/style.registry';
import { ProviderRegistry } from '../provider/provider.registry';
import { ChannelService } from '../channel/channel.service';
import { AssetService } from '../channel/asset.service';
import { CharacterService } from '../channel/character.service';
import { SchemaValidatorService } from '../json-schema/schema-validator.service';
import { RunInsightService } from '../run/run-insight.service';
import { RunService } from '../run/run.service';
import { RunCancellationService } from '../run/run-cancellation.service';
import { RunActionService } from '../run/run-action.service';
import { HumanActionService } from '../run/human-action.service';
import { RunStagePlanService } from '../run/run-stage-plan.service';
import { InvalidationService } from '../run/invalidation.service';
import { MediaReviewService } from './review/media-review.service';
import { AssistantWatchService } from './watch/assistant-watch.service';
import { AssistantSettingsService } from './watch/assistant-settings.service';
import { MediaPreviewService } from '../artifact/media-preview.service';
import { ConfigResolverService } from '../run-config/config-resolver.service';
import { engineDefaults } from '../run-config/engine-defaults';
import { LiveEvents } from '../live/live-events';
import {
  APPROVAL_WAIT_MS,
  ASSISTANT_AGENTS,
  AssistantTurnError,
  type AgentEvent,
  type AssistantAgent,
} from './agent/assistant-agent.interface';
import { answersToText, buildInstructions, contextNote } from './instructions';
import { buildNarrowedEnums, buildToolDefs, runTool, toolsHash } from './tools/registry';
import {
  newTurnContext,
  type ApprovalDecision,
  type ApprovalRequest,
  type ToolDeps,
  type TurnContext,
} from './tools/types';
import { sameDraft } from './tools/draft-diff';
import { titleFrom, truncateForDisplay } from './display';
import { TurnTimer } from './turn-timer';

type SessionRow = typeof assistantSession.$inferSelect;
type ItemRow = typeof assistantItem.$inferSelect;

/** A turn that runs longer than this is stopped and marked failed. */
export const TURN_TIMEOUT_MS = 20 * 60 * 1000;

const PROVIDER_LABELS: Record<string, string> = {
  codex: 'Codex',
  claude: 'Claude',
  fake: 'Fake (test)',
};

/** Chats belong to the local user until Reelcraft has accounts (see common/owner.decorator.ts). */
const OWNER = 'local';

interface PendingApproval {
  sessionId: string;
  resolve: (decision: ApprovalDecision) => void;
}

/**
 * The assistant's chats. A turn runs in this process, not through Inngest: it isn't run
 * state, and a provider turn is a live conversation with tool callbacks that can't be split into
 * durable steps. The durable parts are the provider's own session and the items stored here; a
 * turn cut off by a restart is marked `interrupted` at boot.
 */
@Injectable()
export class AssistantService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssistantService.name);
  /** One running turn per session. */
  private readonly active = new Map<string, AbortController>();
  /** The running turn's tool state, so a mode change reaches it. */
  private readonly turnContexts = new Map<string, TurnContext>();
  /** Approval cards a tool call is waiting on, by item id. */
  private readonly approvals = new Map<string, PendingApproval>();
  /** Run updates that arrived while the chat was busy: told once the turn ends. */
  private readonly pendingWakes = new Map<string, string[]>();
  private readonly seqs = new Map<string, number>();
  private readonly toolDeps: ToolDeps;

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(ASSISTANT_AGENTS) private readonly agents: AssistantAgent[],
    private readonly blueprints: BlueprintService,
    private readonly capabilities: CapabilityRegistry,
    private readonly styles: StyleRegistry,
    providers: ProviderRegistry,
    channels: ChannelService,
    assets: AssetService,
    characters: CharacterService,
    schemas: SchemaValidatorService,
    configResolver: ConfigResolverService,
    runs: RunInsightService,
    media: MediaPreviewService,
    private readonly config: EngineConfig,
    private readonly events: LiveEvents,
    runControl: RunService,
    cancellation: RunCancellationService,
    retries: RunActionService,
    humanActions: HumanActionService,
    stagePlans: RunStagePlanService,
    memory: InvalidationService,
    review: MediaReviewService,
    private readonly watches: AssistantWatchService,
    private readonly assistantSettings: AssistantSettingsService,
  ) {
    this.toolDeps = {
      blueprints,
      capabilities,
      providers,
      styles,
      channels,
      assets,
      characters,
      schemas,
      configResolver,
      runs,
      media,
      runControl,
      cancellation,
      retries,
      humanActions,
      stagePlans,
      attempts: runControl,
      memory,
      review,
      watches,
      engineLayer: () => engineDefaults(config),
      blueprintChanged: (blueprintId) => this.events.publish({ type: 'blueprint', blueprintId }),
    };
  }

  /** A turn that was running when the process stopped can never finish. */
  async onModuleInit(): Promise<void> {
    this.watches.setWakeHandler((sessionId, text) => this.wake(sessionId, text));
    const interrupted = JSON.stringify({ error: 'Interrupted: send your message again.' });
    await this.db
      .update(assistantItem)
      .set({
        state: 'interrupted',
        payload: sql`${assistantItem.payload} || ${interrupted}::jsonb`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(assistantItem.type, 'turn_status'), eq(assistantItem.state, 'running')));
    await this.db
      .update(assistantItem)
      .set({ state: 'failed', updatedAt: sql`now()` })
      .where(and(eq(assistantItem.type, 'tool_call'), eq(assistantItem.state, 'running')));
    await this.db
      .update(assistantItem)
      .set({ state: 'expired', updatedAt: sql`now()` })
      .where(and(eq(assistantItem.type, 'approval'), eq(assistantItem.state, 'pending')));
    await this.db
      .update(assistantSession)
      .set({ status: 'idle' })
      .where(eq(assistantSession.status, 'running'));
  }

  onModuleDestroy(): void {
    for (const pending of this.approvals.values()) pending.resolve({ answer: 'expired' });
    for (const controller of this.active.values()) controller.abort();
    for (const agent of this.agents) agent.close?.();
  }

  // ---- providers -------------------------------------------------------------------------

  async listProviders(): Promise<AssistantProviderDto[]> {
    return Promise.all(
      this.agents.map(async (agent) => {
        let unavailableReason = await agent.unavailableReason().catch((e: unknown) => String(e));
        let models: AssistantProviderDto['models'] = [];
        if (!unavailableReason) {
          try {
            models = await agent.listModels();
          } catch (error) {
            unavailableReason = error instanceof Error ? error.message : String(error);
          }
        }
        return {
          id: agent.providerId,
          label: PROVIDER_LABELS[agent.providerId] ?? agent.providerId,
          unavailableReason,
          models,
        };
      }),
    );
  }

  private agentFor(providerId: string): AssistantAgent {
    const agent = this.agents.find((a) => a.providerId === providerId);
    if (!agent) throw new BadRequestException(`Unknown assistant provider "${providerId}"`);
    return agent;
  }

  // ---- sessions --------------------------------------------------------------------------

  private currentToolsHash(): string {
    return toolsHash(
      buildToolDefs(buildNarrowedEnums({ capabilities: this.capabilities, styles: this.styles })),
    );
  }

  private toSessionDto(row: SessionRow): AssistantSessionDto {
    return {
      id: row.id,
      blueprintId: row.blueprintId,
      providerId: row.providerId,
      mode: row.mode as AssistantMode,
      status: row.status as AssistantSessionDto['status'],
      model: row.model,
      effort: row.effort,
      title: row.title,
      stale: row.appVersion !== this.config.version || row.toolsHash !== this.currentToolsHash(),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toItemDto(row: ItemRow): AssistantItemDto {
    return {
      id: row.id,
      sessionId: row.sessionId,
      turnId: row.turnId,
      seq: row.seq,
      type: row.type as AssistantItemDto['type'],
      state: row.state,
      payload: row.payload,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async requireSession(id: string): Promise<SessionRow> {
    const [row] = await this.db
      .select()
      .from(assistantSession)
      .where(eq(assistantSession.id, id))
      .limit(1);
    if (!row) throw new NotFoundException(`Assistant chat ${id} not found`);
    return row;
  }

  async listSessions(): Promise<AssistantSessionDto[]> {
    const rows = await this.db
      .select()
      .from(assistantSession)
      .where(eq(assistantSession.ownerId, OWNER))
      .orderBy(desc(assistantSession.updatedAt), desc(assistantSession.id));
    return rows.map((row) => this.toSessionDto(row));
  }

  async createSession(dto: CreateAssistantSessionDto): Promise<AssistantSessionDto> {
    if (dto.blueprintId) await this.blueprints.getBlueprint(dto.blueprintId);
    const agent = this.agentFor(dto.providerId);
    const reason = await agent.unavailableReason();
    if (reason) throw new ConflictException(reason);

    const narrowed = buildNarrowedEnums({ capabilities: this.capabilities, styles: this.styles });
    const tools = buildToolDefs(narrowed);
    const externalSessionId = await agent
      .startSession({ instructions: this.instructions(), tools })
      .catch((error: unknown) => {
        throw new ConflictException(error instanceof Error ? error.message : String(error));
      });
    const [row] = await this.db
      .insert(assistantSession)
      .values({
        id: ulid(),
        ownerId: OWNER,
        blueprintId: dto.blueprintId ?? null,
        providerId: dto.providerId,
        externalSessionId,
        appVersion: this.config.version,
        toolsHash: toolsHash(tools),
        mode: dto.mode ?? (await this.assistantSettings.get()).defaultMode,
      })
      .returning();
    this.logger.log({ sessionId: row!.id, providerId: dto.providerId }, 'chat created');
    return this.toSessionDto(row!);
  }

  async getSession(id: string): Promise<AssistantSessionDetailDto> {
    const row = await this.requireSession(id);
    const items = await this.db
      .select()
      .from(assistantItem)
      .where(eq(assistantItem.sessionId, id))
      .orderBy(asc(assistantItem.seq));
    return {
      ...this.toSessionDto(row),
      items: items.map((item) => this.toItemDto(item)),
      watches: await this.watches.list(id),
    };
  }

  async updateSession(id: string, dto: UpdateAssistantSessionDto): Promise<AssistantSessionDto> {
    await this.requireSession(id);
    const [row] = await this.db
      .update(assistantSession)
      .set({ mode: dto.mode, updatedAt: sql`now()` })
      .where(eq(assistantSession.id, id))
      .returning();
    const running = this.turnContexts.get(id);
    if (running) running.mode = dto.mode;
    const session = this.toSessionDto(row!);
    this.publish(id, { type: 'session', session });
    return session;
  }

  async deleteSession(id: string): Promise<void> {
    const row = await this.requireSession(id);
    this.expireApprovals(id);
    this.active.get(id)?.abort();
    this.active.delete(id);
    await this.agentFor(row.providerId)
      .deleteSession(row.externalSessionId)
      .catch((error: unknown) =>
        this.logger.warn({ err: error, sessionId: id }, 'provider session was not deleted'),
      );
    this.pendingWakes.delete(id);
    await this.db.transaction(async (tx) => {
      await this.watches.forgetSession(tx, id);
      await tx.delete(assistantItem).where(eq(assistantItem.sessionId, id));
      await tx.delete(assistantSession).where(eq(assistantSession.id, id));
    });
    this.seqs.delete(id);
  }

  // ---- items -----------------------------------------------------------------------------

  private async ensureSeq(sessionId: string): Promise<void> {
    if (this.seqs.has(sessionId)) return;
    const [row] = await this.db
      .select({ max: sql<number>`coalesce(max(${assistantItem.seq}), 0)` })
      .from(assistantItem)
      .where(eq(assistantItem.sessionId, sessionId));
    this.seqs.set(sessionId, Number(row?.max ?? 0));
  }

  private publish(sessionId: string, event: AssistantStreamEvent): void {
    this.events.publish({ type: 'assistant', sessionId, event });
  }

  private async createItem(
    sessionId: string,
    turnId: string,
    type: AssistantItemDto['type'],
    state: string | null,
    payload: unknown,
  ): Promise<AssistantItemDto> {
    // seq is taken synchronously so concurrent creations keep a stable order
    const seq = (this.seqs.get(sessionId) ?? 0) + 1;
    this.seqs.set(sessionId, seq);
    const [row] = await this.db
      .insert(assistantItem)
      .values({ id: ulid(), sessionId, turnId, seq, type, state, payload })
      .returning();
    const item = this.toItemDto(row!);
    this.publish(sessionId, { type: 'item', item });
    return item;
  }

  private async updateItem(
    id: string,
    patch: { state?: string | null; payload?: unknown },
  ): Promise<AssistantItemDto> {
    const [row] = await this.db
      .update(assistantItem)
      .set({
        ...(patch.state !== undefined && { state: patch.state }),
        ...(patch.payload !== undefined && { payload: patch.payload }),
        updatedAt: sql`now()`,
      })
      .where(eq(assistantItem.id, id))
      .returning();
    if (!row) throw new NotFoundException(`Assistant item ${id} not found`);
    const item = this.toItemDto(row);
    this.publish(item.sessionId, { type: 'item', item });
    return item;
  }

  private async setSessionStatus(
    id: string,
    status: 'idle' | 'running',
    extra: { model?: string; effort?: string | null; title?: string; mode?: AssistantMode } = {},
  ): Promise<void> {
    const [row] = await this.db
      .update(assistantSession)
      .set({ status, updatedAt: sql`now()`, ...extra })
      .where(eq(assistantSession.id, id))
      .returning();
    if (row) this.publish(id, { type: 'session', session: this.toSessionDto(row) });
  }

  private instructions(): string {
    return buildInstructions({
      appVersion: this.config.version,
      date: new Date().toISOString().slice(0, 10),
    });
  }

  /** "the run #a1b2c3d4 of the blueprint …", with the ids the tools need. Null when there is
   * nothing in particular (or it no longer exists). */
  async describeContext(context: AssistantPageContext | undefined): Promise<string | null> {
    if (!context) return null;
    const parts: string[] = [];
    try {
      if (context.runId) {
        const run = await this.toolDeps.runs.get(context.runId);
        if (run) {
          parts.push(
            `the run #${run.runId.slice(-8).toLowerCase()} (runId ${run.runId}, state ${run.state}${
              run.dryRun ? ', a free test run' : ''
            }) of the blueprint "${run.blueprintName}" (blueprintId ${run.blueprintId}, channelId ${run.channelId})`,
          );
          const stage = context.stageKey
            ? run.stages.find((s) => s.key === context.stageKey)
            : undefined;
          if (stage) parts.push(`its stage "${stage.label}" (stageKey ${stage.key})`);
        }
      } else if (context.blueprintId) {
        const blueprint = await this.blueprints.getBlueprint(context.blueprintId);
        parts.push(
          `the blueprint "${blueprint.name}" in the editor (blueprintId ${blueprint.id}, channelId ${blueprint.channelId})`,
        );
        if (context.stageKey) parts.push(`its stage with stageKey ${context.stageKey}`);
      } else if (context.channelId) {
        const channel = await this.toolDeps.channels.get(context.channelId);
        parts.push(`the channel "${channel.name}" (channelId ${channel.id})`);
      }
    } catch {
      // deleted meanwhile: say nothing rather than fail the turn
    }
    if (parts.length) return parts.join(', ');
    const pages: Partial<Record<AssistantPageContext['page'], string>> = {
      home: 'Home',
      blueprints: 'the list of all blueprints',
      runs: 'the list of all runs',
      channels: 'the list of channels',
      settings: 'Settings',
    };
    return pages[context.page] ?? null;
  }

  // ---- turns -----------------------------------------------------------------------------

  async startTurn(
    sessionId: string,
    dto: StartAssistantTurnDto,
    source: 'user' | 'wake' = 'user',
  ): Promise<{ turnId: string }> {
    if (this.active.has(sessionId)) {
      throw new ConflictException('A turn is already running in this chat.');
    }
    const controller = new AbortController();
    // reserve the slot before any await so two requests can't both start a turn
    this.active.set(sessionId, controller);
    let prepared;
    try {
      prepared = await this.prepareTurn(sessionId, dto, source);
    } catch (error) {
      this.active.delete(sessionId);
      throw error;
    }
    void this.runTurn(prepared, dto, controller);
    return { turnId: prepared.turnId };
  }

  private async prepareTurn(
    sessionId: string,
    dto: StartAssistantTurnDto,
    source: 'user' | 'wake' = 'user',
  ) {
    const session = await this.requireSession(sessionId);
    const agent = this.agentFor(session.providerId);
    await this.ensureSeq(sessionId);

    const pending = await this.db
      .select()
      .from(assistantItem)
      .where(
        and(
          eq(assistantItem.sessionId, sessionId),
          eq(assistantItem.type, 'question'),
          eq(assistantItem.state, 'pending'),
        ),
      );

    const plans = await this.db
      .select()
      .from(assistantItem)
      .where(
        and(
          eq(assistantItem.sessionId, sessionId),
          eq(assistantItem.type, 'plan'),
          eq(assistantItem.state, 'pending'),
        ),
      );

    let text = dto.text ?? '';
    let answered: ItemRow | undefined;
    if (dto.answer) {
      answered = pending.find((item) => item.id === dto.answer!.questionItemId);
      if (!answered) throw new BadRequestException('That question is not waiting for an answer.');
      const payload = answered.payload as QuestionPayload;
      const answerText = answersToText(payload.questions, dto.answer.answers);
      text = text ? `${answerText}\n\n${text}` : answerText;
    }

    const turnId = ulid();
    for (const question of pending) {
      const payload = question.payload as QuestionPayload;
      if (question.id === answered?.id) {
        await this.updateItem(question.id, {
          state: 'answered',
          payload: { ...payload, answers: dto.answer!.answers },
        });
      } else {
        await this.updateItem(question.id, { state: 'dismissed' });
      }
    }
    // a plan decided through decidePlan is no longer pending here; anything else moved on
    for (const plan of plans) await this.updateItem(plan.id, { state: 'dismissed' });

    await this.createItem(sessionId, turnId, 'user_message', null, {
      text,
      context: dto.context ?? null,
      model: dto.model,
      effort: dto.effort ?? null,
      mode: session.mode,
      ...(source === 'wake' && { source }),
    });
    const statusItem = await this.createItem(sessionId, turnId, 'turn_status', 'running', {
      model: dto.model,
      effort: dto.effort ?? null,
    });
    await this.setSessionStatus(sessionId, 'running', {
      model: dto.model,
      effort: dto.effort ?? null,
      ...(session.title ? {} : { title: titleFrom(text) }),
    });
    return { session, agent, turnId, text, statusItem };
  }

  private async runTurn(
    prepared: Awaited<ReturnType<AssistantService['prepareTurn']>>,
    dto: StartAssistantTurnDto,
    controller: AbortController,
  ): Promise<void> {
    const { session, agent, turnId, text, statusItem } = prepared;
    const timer = new TurnTimer(TURN_TIMEOUT_MS, () => {
      timedOut = true;
      controller.abort();
    });
    const ctx = newTurnContext({
      sessionId: session.id,
      mode: session.mode as AssistantMode,
      editorDraft: dto.editorDraft ?? null,
      confirm: (request) =>
        this.confirm(session.id, turnId, ctx, request, timer, controller.signal),
    });
    this.turnContexts.set(session.id, ctx);
    const messages = new Map<string, { id: string; text: string }>();
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    let timedOut = false;
    // agent events arrive synchronously but persisting them is async: keep them in order
    let queue: Promise<void> = Promise.resolve();

    const handleEvent = async (event: AgentEvent): Promise<void> => {
      if (event.type === 'usage') {
        usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
        return;
      }
      const known = messages.get(event.itemKey);
      if (event.type === 'message.delta') {
        if (!known) {
          const item = await this.createItem(session.id, turnId, 'agent_message', null, {
            text: event.text,
          });
          messages.set(event.itemKey, { id: item.id, text: event.text });
        } else {
          known.text += event.text;
          this.publish(session.id, {
            type: 'delta',
            turnId,
            itemId: known.id,
            text: event.text,
          });
        }
        return;
      }
      if (!known) {
        const item = await this.createItem(session.id, turnId, 'agent_message', null, {
          text: event.text,
        });
        messages.set(event.itemKey, { id: item.id, text: event.text });
      } else {
        known.text = event.text;
        await this.updateItem(known.id, { payload: { text: event.text } });
      }
    };

    const callTool = async (tool: string, args: unknown) => {
      await queue;
      const callItem = await this.createItem(session.id, turnId, 'tool_call', 'running', {
        tool,
        args,
      });
      const outcome = await runTool(tool, args, ctx, this.toolDeps);
      let extra: Record<string, unknown> = {};
      if (outcome.ok && outcome.item) {
        const state = outcome.item.type === 'change' ? 'applied' : 'pending';
        const created = await this.createItem(
          session.id,
          turnId,
          outcome.item.type,
          state,
          outcome.item.payload,
        );
        extra = { [`${outcome.item.type}Id`]: created.id };
      }
      const forModel = outcome.ok
        ? { ...(isRecord(outcome.result) ? outcome.result : { result: outcome.result }), ...extra }
        : { error: outcome.error, ...(outcome.issues && { issues: outcome.issues }) };
      const images = outcome.ok ? outcome.images : undefined;
      await this.updateItem(callItem.id, {
        state: outcome.ok ? 'completed' : 'failed',
        payload: {
          tool,
          args,
          ok: outcome.ok,
          result: truncateForDisplay(forModel),
          // the pictures go to the model only: the transcript keeps their count and size
          ...(images?.length && {
            images: images.map((image) => ({
              mime: image.mime,
              kb: Math.round((image.base64.length * 3) / 4 / 1024),
            })),
          }),
        },
      });
      return { ok: outcome.ok, text: JSON.stringify(forModel), ...(images?.length && { images }) };
    };

    let finalState: 'completed' | 'failed' | 'interrupted' = 'completed';
    let error: string | undefined;
    try {
      const where = await this.describeContext(dto.context);
      await agent.runTurn({
        sessionId: session.externalSessionId,
        text: `${text}\n\n${contextNote(ctx.mode, where)}`,
        model: dto.model,
        effort: dto.effort,
        instructions: this.instructions(),
        mode: ctx.mode,
        signal: controller.signal,
        handlers: {
          callTool,
          onEvent: (event) => {
            queue = queue.then(() => handleEvent(event)).catch(this.logQueueError);
          },
        },
      });
    } catch (caught) {
      if (timedOut) {
        finalState = 'failed';
        error = `The turn took longer than ${TURN_TIMEOUT_MS / 60000} minutes and was stopped.`;
      } else if (
        (caught instanceof AssistantTurnError && caught.kind === 'interrupted') ||
        controller.signal.aborted
      ) {
        finalState = 'interrupted';
      } else {
        finalState = 'failed';
        error = caught instanceof Error ? caught.message : String(caught);
        this.logger.warn({ err: caught, sessionId: session.id }, 'assistant turn failed');
      }
    } finally {
      timer.stop();
      this.expireApprovals(session.id);
      await queue.catch(this.logQueueError);
      this.active.delete(session.id);
      this.turnContexts.delete(session.id);
    }
    // a run update that came in meanwhile is told now
    const next = this.pendingWakes.get(session.id)?.shift();
    if (next !== undefined) {
      setImmediate(() => void this.wake(session.id, next).catch(this.logQueueError));
    }

    try {
      await this.updateItem(statusItem.id, {
        state: finalState,
        payload: {
          model: dto.model,
          effort: dto.effort ?? null,
          ...(error && { error }),
          ...(usage && { usage }),
        },
      });
      await this.setSessionStatus(session.id, 'idle');
    } catch (persistError) {
      // the chat (or its blueprint) was deleted while the turn ran
      this.logger.warn({ err: persistError, sessionId: session.id }, 'turn result not stored');
    }
  }

  private readonly logQueueError = (error: unknown): void => {
    this.logger.warn({ err: error }, 'assistant event not stored');
  };

  async interrupt(sessionId: string): Promise<void> {
    await this.requireSession(sessionId);
    const controller = this.active.get(sessionId);
    if (!controller) throw new ConflictException('No turn is running in this chat.');
    controller.abort();
  }

  // ---- run watches -----------------------------------------------------------------------

  /** A watched run changed: tell the chat in a new turn (after the running one, if any), with
   * the model it used last. */
  async wake(sessionId: string, text: string): Promise<void> {
    if (this.active.has(sessionId)) {
      const queue = this.pendingWakes.get(sessionId) ?? [];
      queue.push(text);
      this.pendingWakes.set(sessionId, queue);
      return;
    }
    const session = await this.requireSession(sessionId).catch(() => null);
    if (!session) return;
    const agent = this.agentFor(session.providerId);
    let model = session.model;
    if (!model) {
      const models = await agent.listModels().catch(() => []);
      model = (models.find((m) => m.isDefault) ?? models[0])?.modelId ?? null;
    }
    if (!model) return;
    await this.startTurn(
      sessionId,
      { text, model, ...(session.effort && { effort: session.effort }) },
      'wake',
    ).catch((error: unknown) => {
      this.logger.warn({ err: error, sessionId }, 'assistant could not be woken');
    });
  }

  listWatches(sessionId: string) {
    return this.watches.list(sessionId);
  }

  async unwatch(sessionId: string, runId: string) {
    await this.requireSession(sessionId);
    return this.watches.unwatch(sessionId, runId);
  }

  getSettings() {
    return this.assistantSettings.get();
  }

  updateSettings(dto: UpdateAssistantSettingsDto) {
    return this.assistantSettings.update(dto);
  }

  // ---- approvals (Manual mode) ---------------------------------------------------------

  /** A tool's request to change something. Auto says yes at once. Manual puts a card in the chat
   * and waits (the turn's clock stops meanwhile) for the user, a timeout or the turn's end. */
  private async confirm(
    sessionId: string,
    turnId: string,
    ctx: TurnContext,
    request: ApprovalRequest,
    timer: TurnTimer,
    signal: AbortSignal,
  ): Promise<ApprovalDecision> {
    if (ctx.mode === 'auto') return { answer: 'yes' };
    if (signal.aborted) return { answer: 'expired' };
    const payload: ApprovalPayload = {
      tool: request.tool,
      kind: request.kind,
      title: request.title,
      details: request.details ?? [],
      costUsd: request.costUsd ?? null,
      ...(request.change && { change: request.change }),
    };
    const item = await this.createItem(sessionId, turnId, 'approval', 'pending', payload);
    timer.pause();
    try {
      return await new Promise<ApprovalDecision>((resolve) => {
        const done = (decision: ApprovalDecision) => {
          clearTimeout(expiry);
          signal.removeEventListener('abort', onAbort);
          this.approvals.delete(item.id);
          resolve(decision);
        };
        const onAbort = () => done({ answer: 'expired' });
        const expiry = setTimeout(() => done({ answer: 'expired' }), APPROVAL_WAIT_MS);
        signal.addEventListener('abort', onAbort);
        this.approvals.set(item.id, { sessionId, resolve: done });
      }).then(async (decision) => {
        if (decision.answer === 'expired') {
          await this.updateItem(item.id, { state: 'expired' }).catch(this.logQueueError);
        }
        return decision;
      });
    } finally {
      timer.resume();
    }
  }

  private expireApprovals(sessionId: string): void {
    for (const pending of [...this.approvals.values()]) {
      if (pending.sessionId === sessionId) pending.resolve({ answer: 'expired' });
    }
  }

  /** The user's answer to an approval card. */
  async decideApproval(
    sessionId: string,
    itemId: string,
    dto: DecideApprovalDto,
  ): Promise<AssistantItemDto> {
    const row = await this.requireItem(sessionId, itemId, 'approval');
    const pending = this.approvals.get(itemId);
    if (row.state !== 'pending' || !pending) {
      throw new ConflictException('This request is no longer waiting for an answer.');
    }
    const payload = row.payload as ApprovalPayload;
    const item = await this.updateItem(itemId, {
      state: dto.answer === 'no' ? 'denied' : 'approved',
      payload: {
        ...payload,
        answer: dto.answer,
        ...(dto.answer === 'no' && dto.feedback ? { feedback: dto.feedback } : {}),
      },
    });
    if (dto.answer === 'yes_auto') await this.updateSession(sessionId, { mode: 'auto' });
    pending.resolve(
      dto.answer === 'no' ? { answer: 'no', feedback: dto.feedback } : { answer: dto.answer },
    );
    return item;
  }

  // ---- plans (Plan mode) -----------------------------------------------------------------

  /** Approving a plan switches the chat to Auto or Manual and starts a turn that carries it out;
   * "Keep planning" sends the feedback back in Plan mode. */
  async decidePlan(
    sessionId: string,
    itemId: string,
    dto: DecidePlanDto,
  ): Promise<{ turnId: string }> {
    const row = await this.requireItem(sessionId, itemId, 'plan');
    if (row.state !== 'pending') throw new ConflictException('This plan was already decided.');
    if (this.active.has(sessionId)) {
      throw new ConflictException('A turn is already running in this chat.');
    }
    const payload = row.payload as PlanPayload;
    await this.updateItem(itemId, {
      state: dto.decision === 'revise' ? 'revised' : 'approved',
      payload: {
        ...payload,
        decision: dto.decision,
        ...(dto.feedback ? { feedback: dto.feedback } : {}),
      },
    });
    let text: string;
    if (dto.decision === 'revise') {
      text = `Keep planning. Change the plan "${payload.title}": ${dto.feedback || 'the user wants changes'}`;
    } else {
      await this.updateSession(sessionId, { mode: dto.decision });
      text = `The user approved your plan "${payload.title}". Carry it out now, step by step, in ${
        dto.decision === 'auto' ? 'Auto' : 'Manual'
      } mode.${dto.feedback ? ` They added: ${dto.feedback}` : ''}`;
    }
    return this.startTurn(sessionId, {
      text,
      model: dto.model,
      ...(dto.effort && { effort: dto.effort }),
    });
  }

  // ---- changes ---------------------------------------------------------------------------

  /** Puts a blueprint back the way it was before one of the assistant's changes, as long as
   * nothing has changed it since. */
  async undoChange(sessionId: string, itemId: string): Promise<AssistantItemDto> {
    const row = await this.requireItem(sessionId, itemId, 'change');
    if (row.state === 'undone') return this.toItemDto(row);
    const change = row.payload as ChangePayload;
    const blueprint = await this.blueprints.getBlueprint(change.blueprintId);
    if (change.kind === 'draft') {
      const working =
        blueprint.workingDraft && blueprint.workingDraftBaseVersionId === blueprint.currentVersionId
          ? (blueprint.workingDraft as CreateBlueprintVersionDto)
          : null;
      if (!working || !sameDraft(working, change.after)) {
        throw new ConflictException(
          'The blueprint has changed since, so this can no longer be undone here. Use its History, or ask the assistant.',
        );
      }
      await this.blueprints.setWorkingDraft(
        change.blueprintId,
        change.before,
        blueprint.currentVersionId,
      );
    } else {
      const restore = Object.fromEntries(
        Object.keys(change.changes).map((key) => [
          key,
          change.previous[key as keyof typeof change.previous],
        ]),
      );
      await this.blueprints.update(change.blueprintId, restore);
    }
    this.events.publish({ type: 'blueprint', blueprintId: change.blueprintId });
    return this.updateItem(itemId, { state: 'undone' });
  }

  private async requireItem(sessionId: string, itemId: string, type: string): Promise<ItemRow> {
    await this.requireSession(sessionId);
    const [row] = await this.db
      .select()
      .from(assistantItem)
      .where(and(eq(assistantItem.id, itemId), eq(assistantItem.sessionId, sessionId)))
      .limit(1);
    if (!row || row.type !== type) throw new NotFoundException('Item not found');
    return row;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
