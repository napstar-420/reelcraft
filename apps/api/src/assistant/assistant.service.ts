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
  AssistantItemDto,
  AssistantProviderDto,
  AssistantSessionDetailDto,
  AssistantSessionDto,
  AssistantStreamEvent,
  CreateAssistantSessionDto,
  ProposalPayload,
  QuestionPayload,
  StartAssistantTurnDto,
  UpdateAssistantSessionDto,
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
import { MediaPreviewService } from '../artifact/media-preview.service';
import { ConfigResolverService } from '../run-config/config-resolver.service';
import { engineDefaults } from '../run-config/engine-defaults';
import { AssistantEvents } from './assistant-events';
import {
  ASSISTANT_AGENTS,
  AssistantTurnError,
  type AgentEvent,
  type AssistantAgent,
} from './agent/assistant-agent.interface';
import { answersToText, applyModeNote, buildInstructions } from './instructions';
import { buildNarrowedEnums, buildToolDefs, runTool, toolsHash } from './tools/registry';
import { newTurnContext, type ToolDeps } from './tools/types';
import { titleFrom, truncateForDisplay } from './display';

type SessionRow = typeof assistantSession.$inferSelect;
type ItemRow = typeof assistantItem.$inferSelect;

/** A turn that runs longer than this is stopped and marked failed. */
export const TURN_TIMEOUT_MS = 20 * 60 * 1000;

const PROVIDER_LABELS: Record<string, string> = { codex: 'Codex', fake: 'Fake (test)' };

/**
 * The blueprint assistant's chats. A turn runs in this process, not through Inngest: it isn't run
 * state, and a provider turn is a live conversation with tool callbacks that can't be split into
 * durable steps. The durable parts are the provider's own session and the items stored here; a
 * turn cut off by a restart is marked `interrupted` at boot.
 */
@Injectable()
export class AssistantService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssistantService.name);
  /** One running turn per session. */
  private readonly active = new Map<string, AbortController>();
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
    private readonly events: AssistantEvents,
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
      engineLayer: () => engineDefaults(config),
    };
  }

  /** A turn that was running when the process stopped can never finish. */
  async onModuleInit(): Promise<void> {
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
      .update(assistantSession)
      .set({ status: 'idle' })
      .where(eq(assistantSession.status, 'running'));
  }

  onModuleDestroy(): void {
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
      applyMode: row.applyMode as AssistantSessionDto['applyMode'],
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

  async listSessions(blueprintId: string): Promise<AssistantSessionDto[]> {
    await this.blueprints.getBlueprint(blueprintId);
    const rows = await this.db
      .select()
      .from(assistantSession)
      .where(eq(assistantSession.blueprintId, blueprintId))
      .orderBy(desc(assistantSession.createdAt), desc(assistantSession.id));
    return rows.map((row) => this.toSessionDto(row));
  }

  async createSession(
    blueprintId: string,
    dto: CreateAssistantSessionDto,
  ): Promise<AssistantSessionDto> {
    const blueprint = await this.blueprints.getBlueprint(blueprintId);
    const agent = this.agentFor(dto.providerId);
    const reason = await agent.unavailableReason();
    if (reason) throw new ConflictException(reason);

    const narrowed = buildNarrowedEnums({ capabilities: this.capabilities, styles: this.styles });
    const tools = buildToolDefs(narrowed);
    const externalSessionId = await agent
      .startSession({ instructions: this.instructionsFor(blueprint.name), tools })
      .catch((error: unknown) => {
        throw new ConflictException(error instanceof Error ? error.message : String(error));
      });
    const [row] = await this.db
      .insert(assistantSession)
      .values({
        id: ulid(),
        blueprintId,
        providerId: dto.providerId,
        externalSessionId,
        appVersion: this.config.version,
        toolsHash: toolsHash(tools),
        applyMode: dto.applyMode,
      })
      .returning();
    this.logger.log(
      { sessionId: row!.id, blueprintId, providerId: dto.providerId },
      'chat created',
    );
    return this.toSessionDto(row!);
  }

  async getSession(id: string): Promise<AssistantSessionDetailDto> {
    const row = await this.requireSession(id);
    const items = await this.db
      .select()
      .from(assistantItem)
      .where(eq(assistantItem.sessionId, id))
      .orderBy(asc(assistantItem.seq));
    return { ...this.toSessionDto(row), items: items.map((item) => this.toItemDto(item)) };
  }

  async updateSession(id: string, dto: UpdateAssistantSessionDto): Promise<AssistantSessionDto> {
    await this.requireSession(id);
    const [row] = await this.db
      .update(assistantSession)
      .set({ applyMode: dto.applyMode, updatedAt: sql`now()` })
      .where(eq(assistantSession.id, id))
      .returning();
    const session = this.toSessionDto(row!);
    this.events.publish(id, { type: 'session', session });
    return session;
  }

  async deleteSession(id: string): Promise<void> {
    const row = await this.requireSession(id);
    this.active.get(id)?.abort();
    this.active.delete(id);
    await this.agentFor(row.providerId)
      .deleteSession(row.externalSessionId)
      .catch((error: unknown) =>
        this.logger.warn({ err: error, sessionId: id }, 'provider session was not deleted'),
      );
    await this.db.transaction(async (tx) => {
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
    this.events.publish(sessionId, event);
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
    extra: { model?: string; effort?: string | null; title?: string } = {},
  ): Promise<void> {
    const [row] = await this.db
      .update(assistantSession)
      .set({ status, updatedAt: sql`now()`, ...extra })
      .where(eq(assistantSession.id, id))
      .returning();
    if (row) this.publish(id, { type: 'session', session: this.toSessionDto(row) });
  }

  private instructionsFor(blueprintName: string): string {
    return buildInstructions({
      blueprintName,
      appVersion: this.config.version,
      date: new Date().toISOString().slice(0, 10),
    });
  }

  // ---- turns -----------------------------------------------------------------------------

  async startTurn(sessionId: string, dto: StartAssistantTurnDto): Promise<{ turnId: string }> {
    if (this.active.has(sessionId)) {
      throw new ConflictException('A turn is already running in this chat.');
    }
    const controller = new AbortController();
    // reserve the slot before any await so two requests can't both start a turn
    this.active.set(sessionId, controller);
    let prepared;
    try {
      prepared = await this.prepareTurn(sessionId, dto);
    } catch (error) {
      this.active.delete(sessionId);
      throw error;
    }
    void this.runTurn(prepared, dto, controller);
    return { turnId: prepared.turnId };
  }

  private async prepareTurn(sessionId: string, dto: StartAssistantTurnDto) {
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

    const userItem = await this.createItem(sessionId, turnId, 'user_message', null, {
      text,
      baseDraft: dto.draft,
      model: dto.model,
      effort: dto.effort ?? null,
      applyMode: session.applyMode,
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
    return { session, agent, turnId, text, userItem, statusItem };
  }

  private async runTurn(
    prepared: Awaited<ReturnType<AssistantService['prepareTurn']>>,
    dto: StartAssistantTurnDto,
    controller: AbortController,
  ): Promise<void> {
    const { session, agent, turnId, text, userItem, statusItem } = prepared;
    const ctx = newTurnContext(session.blueprintId, dto.draft);
    let baseItemId = userItem.id;
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
      if (outcome.ok && outcome.item?.type === 'proposal') {
        const payload: ProposalPayload =
          outcome.item.payload.kind === 'draft'
            ? { ...outcome.item.payload, baseItemId }
            : outcome.item.payload;
        const proposal = await this.createItem(session.id, turnId, 'proposal', 'pending', payload);
        if (payload.kind === 'draft') baseItemId = proposal.id;
        extra = { proposalId: proposal.id };
      } else if (outcome.ok && outcome.item?.type === 'question') {
        const question = await this.createItem(
          session.id,
          turnId,
          'question',
          'pending',
          outcome.item.payload,
        );
        extra = { questionId: question.id };
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

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TURN_TIMEOUT_MS);

    let finalState: 'completed' | 'failed' | 'interrupted' = 'completed';
    let error: string | undefined;
    try {
      const blueprint = await this.blueprints.getBlueprint(session.blueprintId);
      await agent.runTurn({
        sessionId: session.externalSessionId,
        text: `${text}\n\n${applyModeNote(session.applyMode as 'manual' | 'auto')}`,
        model: dto.model,
        effort: dto.effort,
        instructions: this.instructionsFor(blueprint.name),
        applyMode: session.applyMode as 'manual' | 'auto',
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
      clearTimeout(timer);
      await queue.catch(this.logQueueError);
      this.active.delete(session.id);
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

  // ---- proposals -------------------------------------------------------------------------

  /** Marks a proposal applied. A metadata proposal is applied here (name, description, tags); a
   * draft proposal is applied by the open canvas, which then calls this to record it. Idempotent. */
  async applyProposal(sessionId: string, itemId: string): Promise<AssistantItemDto> {
    const session = await this.requireSession(sessionId);
    const [row] = await this.db
      .select()
      .from(assistantItem)
      .where(and(eq(assistantItem.id, itemId), eq(assistantItem.sessionId, sessionId)))
      .limit(1);
    if (!row || row.type !== 'proposal') throw new NotFoundException('Proposal not found');
    if (row.state === 'applied') return this.toItemDto(row);
    const payload = row.payload as ProposalPayload;
    if (payload.kind === 'metadata') {
      await this.blueprints.update(session.blueprintId, payload.changes);
    }
    return this.updateItem(itemId, { state: 'applied' });
  }

  streamEvents(sessionId: string) {
    return this.events.stream(sessionId);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
