import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import type {
  AttemptOutcome,
  HumanWaitKind,
  JobHandle,
  JobStatus,
  QcDef,
  Ref,
} from '@reelcraft/shared';
import { StageDef, approvalModeOf } from '@reelcraft/shared';
import { DRIZZLE, type Db, type Tx } from '../db/drizzle.provider';
import {
  artifact,
  blob,
  run,
  blueprintVersion,
  stageAttempt,
  stageExecution,
  stageItem,
  channel,
} from '../db/schema/index';
import { ulid } from '../common/ulid';
import { fromUsd, toUsd } from '../common/money';
import { renderStagePrompt } from '../common/prompt-template';
import { unwrapText } from '../common/unwrap-text';
import { collectFileInputs, promptScopeWithRoles } from '../common/file-inputs';
import { CapabilityRegistry } from '../capability/capability.registry';
import {
  BindingResolverService,
  type RefEnvelope,
  type ResolvedBindings,
  type RoleBinding,
} from '../artifact/binding-resolver.service';
import { ArtifactService } from '../artifact/artifact.service';
import { BlobService } from '../artifact/blob.service';
import { MediaArtifactService } from '../artifact/media-artifact.service';
import { MemoryService } from '../artifact/memory.service';
import { LedgerService } from '../budget/ledger.service';
import {
  ConfigResolverService,
  type EffectiveStageConfig,
} from '../run-config/config-resolver.service';
import { SchemaValidatorService } from '../json-schema/schema-validator.service';
import { EngineConfig } from '../config/engine-config';
import { CheckRunner } from '../check/check-runner.service';
import type { CheckArtifact, CheckResult } from '../check/check.types';
import { QcRunner, type QcOutcome, type QcVerdict } from '../qc/qc-runner.service';
import { QcAudioService } from '../qc/qc-audio';
import { buildQcEnvelope } from '../qc/qc-envelope';
import { HumanWaitService } from '../run/human-wait.service';
import { TimelineCheckService } from '../check/timeline-check.service';
import { TimelineHandleService } from '../artifact/timeline-handle.service';
import { TimelineResourceResolverService } from '../artifact/timeline-resource-resolver.service';
import { FileArtifactService } from '../artifact/file-artifact.service';
import { ArtifactAttachmentService } from '../artifact/artifact-attachment.service';
import { StageEventService, type StageEventLevel } from './stage-event.service';

export interface StageAttemptContext {
  runId: string;
  stageExecutionId: string;
  stageKey: string;
  attemptNo: number;
  stageAttemptId: string;
  /** phase 7 chunk 4 — set by `stage.execute.item`'s per-item body; every
   * non-iterating call site leaves this undefined, so
   * `BindingResolverService`/`ExecCtx` see exactly today's behavior. */
  itemIndex?: number | undefined;
  /** phase 7 chunk 4 — the `stage_item` row this attempt belongs to, set
   * together with `itemIndex`. Threads through to every attempt-scoped
   * query (`beginAttempt`'s own predicate, `countRoundAttempts`,
   * `loadCritiqueLog`, `failStageExecution` via
   * `recordFailure`) so an item's attempts never mix with the stage's own
   * (non-item) attempts or another item's. */
  stageItemId?: string | undefined;
}

export interface StageContext {
  stage: StageDef;
  effective: EffectiveStageConfig;
  prevStageKey: string | undefined;
}

/** §7/§9/§10 — everything past the fetch that can end a stage attempt
 * without a thrown exception. `check_failed`/`qc_failed` regenerate with
 * feedback, capped by `checkMaxAttempts`/`qc.maxAttempts` (never
 * `retryLimit`); `qc_error` is terminal regardless of remaining
 * `retryLimit` (an interpretation of §10.4 — a judge that can't produce a
 * verdict after `qcErrorRetries` attempts isn't something re-prompting the
 * generating stage can fix). */
export type FetchAndFinalizeResult =
  | { outcome: 'success'; artifactId: string }
  | { outcome: 'approval_required'; artifactId: string }
  | { outcome: 'run_not_running' }
  | { outcome: 'check_failed'; checkResults: CheckResult[] }
  | { outcome: 'qc_failed'; checkResults: CheckResult[]; qcVerdict: QcVerdict }
  | { outcome: 'qc_error'; reason: string }
  | { outcome: 'model_error'; reason: string }
  | { outcome: 'deferred'; resumeAt: string }
  | { outcome: 'qc_budget_exhausted'; checkResults: CheckResult[] };

/** §11 — `reserveAndSubmit`'s outcome: either a reservation was made and
 * the job submitted, or the reserve step itself rejected the attempt
 * before any provider was ever contacted (§11.4's `created` phase — the
 * attempt row never advances to `reserved`/`submitting`). */
export type SubmitOutcome =
  | { outcome: 'submitted'; handle: JobHandle }
  | { outcome: 'budget_blocked'; reason: 'run_cap_exceeded' | 'stage_cap_exceeded' }
  | { outcome: 'run_not_running' };

/** One clip a capability hands back for a `media.video_list` output. */
interface ClipOutput {
  index: number;
  label?: string;
  prompt?: string;
  source: import('@reelcraft/shared').MediaSource;
}

function clipFilename(clip: ClipOutput): string {
  return clip.source.filename ?? `clip-${clip.index}.mp4`;
}

type PersistedClip = { clip: ClipOutput } & Awaited<ReturnType<MediaArtifactService['persist']>>;

type MediaProbe = Awaited<ReturnType<MediaArtifactService['persist']>>['probe'];

/** A stored, not yet finalized attempt output, as checks and quality control
 * see it. Built right after a fetch, or rebuilt from the database to retry
 * quality control on its own. */
interface Candidate {
  kind: CheckArtifact['kind'];
  data: unknown;
  /** What the capability returned (a timeline's checks read it as such). */
  output: unknown;
  artifactId: string;
  costUsd: number;
  media?: {
    storageKey: string;
    probe: MediaProbe;
    mime?: string | undefined;
  };
  /** A clip list's clips, ready for the judge. */
  clips: Array<{ sourceKey: string; mime: string; index: number; label: string }>;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';
}

/**
 * §3/§7.2/§13 — the engine loop for one stage attempt: resolve inputs,
 * submit, poll, fetch, check, QC, finalize. Split into small methods so the
 * Inngest function (functions/stage-execute.fn.ts) can place a step
 * boundary around each provider call (§13.3) — steps return IDs, never
 * payloads (§13.2 Rule 1). Binding resolution deliberately happens INSIDE
 * `reserveAndSubmit`/`fetchAndFinalize` rather than being passed in from the
 * caller: a bound value can be a whole artifact's `data`, and threading it
 * through as a step argument would memoize that payload into Inngest's
 * durable step state.
 */
@Injectable()
export class StageRunnerService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly capabilities: CapabilityRegistry,
    private readonly bindingResolver: BindingResolverService,
    private readonly artifacts: ArtifactService,
    private readonly blobs: BlobService,
    private readonly mediaArtifacts: MediaArtifactService,
    private readonly memory: MemoryService,
    private readonly ledger: LedgerService,
    private readonly configResolver: ConfigResolverService,
    private readonly schemaValidator: SchemaValidatorService,
    private readonly checks: CheckRunner,
    private readonly qc: QcRunner,
    private readonly engineConfig: EngineConfig,
    private readonly humanWaits: HumanWaitService,
    private readonly timelineChecks: TimelineCheckService,
    private readonly timelineHandles: TimelineHandleService,
    private readonly timelineResources: TimelineResourceResolverService,
    private readonly fileArtifacts: FileArtifactService,
    private readonly artifactAttachments: ArtifactAttachmentService,
    private readonly events: StageEventService,
    private readonly qcAudio: QcAudioService,
  ) {}

  interactionFor(capabilityKey: string): 'form' | 'timeline_editor' | undefined {
    return this.capabilities.get(capabilityKey).interaction?.kind;
  }

  infraAttemptLimit(): number {
    return this.engineConfig.infraRetries + 1;
  }

  /** Parks an orchestrator-only human.input stage without creating an
   * engine attempt, reservation, or provider job. */
  async awaitHumanInput(
    runId: string,
    stageExecutionId: string,
    kind: Extract<HumanWaitKind, 'input' | 'timeline_edit'> = 'input',
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(stageExecution)
        .set({ state: 'awaiting_input', startedAt: new Date().toISOString() })
        .where(eq(stageExecution.id, stageExecutionId));
      await this.humanWaits.open(tx, { runId, stageExecutionId, kind });
    });
  }

  async loadStageContext(runId: string, stageKey: string): Promise<StageContext> {
    const [row] = await this.db
      .select({ graph: blueprintVersion.graph })
      .from(run)
      .innerJoin(blueprintVersion, eq(run.blueprintVersionId, blueprintVersion.id))
      .where(eq(run.id, runId))
      .limit(1);
    if (!row) throw new Error(`StageRunnerService: run ${runId} not found`);

    const graph = StageDef.array().parse(row.graph);
    const stage = graph.find((s) => s.key === stageKey);
    if (!stage)
      throw new Error(`StageRunnerService: stage "${stageKey}" not in run ${runId}'s graph`);

    const index = graph.indexOf(stage);
    const prevStageKey = index > 0 ? graph[index - 1]?.key : undefined;
    const effective = await this.configResolver.effectiveStageConfig(runId, stageKey, stage);

    return { stage, effective, prevStageKey };
  }

  /**
   * §3.8/§13.2 Rule 2 — `attemptNo` is derived from the DB, never a
   * loop-local variable: `SELECT coalesce(max(attemptNo), 0) + 1` then
   * insert. On a unique-violation (a replayed Inngest step recomputing the
   * same attemptNo), re-select the existing row instead of erroring — this
   * is what makes the step idempotent without a separate locking mechanism,
   * given `run.orchestrate`'s `concurrency: {limit:1, key:runId}` guarantees
   * no concurrent inserts for the same run.
   */
  async beginAttempt(ctx: {
    runId: string;
    stageExecutionId: string;
    stageKey: string;
    itemIndex?: number | undefined;
    stageItemId?: string | undefined;
  }): Promise<StageAttemptContext> {
    const scopePredicate = ctx.stageItemId
      ? eq(stageAttempt.stageItemId, ctx.stageItemId)
      : isNull(stageAttempt.stageItemId);

    // First attempt of the stage (any item) marks when it actually started
    // running, for display in the run timeline. Coalesce so a replayed step
    // or a retry of an already-started stage doesn't push the time forward.
    await this.db
      .update(stageExecution)
      .set({ startedAt: sql`coalesce(${stageExecution.startedAt}, now())` })
      .where(eq(stageExecution.id, ctx.stageExecutionId));

    // The UI's only signal that a stage is actively executing (as opposed
    // to not started yet) — flip 'pending' -> 'running' here, once. Scoped
    // to 'pending' so a replayed step, a retry, or an item-mode attempt that
    // finds the stage already in some other state (e.g. 'awaiting_approval'
    // from a sibling item) never clobbers it.
    await this.db
      .update(stageExecution)
      .set({ state: 'running' })
      .where(and(eq(stageExecution.id, ctx.stageExecutionId), eq(stageExecution.state, 'pending')));

    // phase 7 chunk 4 — an item's first attempt (and every retry of it)
    // marks the stage_item 'running'. Idempotent to repeat on a replayed
    // step or a resumed retry of a previously-'failed' item.
    if (ctx.stageItemId) {
      await this.db
        .update(stageItem)
        .set({ state: 'running' })
        .where(eq(stageItem.id, ctx.stageItemId));
    }

    const [row] = await this.db
      .select({ maxAttempt: sql<number>`coalesce(max(${stageAttempt.attemptNo}), 0)` })
      .from(stageAttempt)
      .where(and(eq(stageAttempt.stageExecutionId, ctx.stageExecutionId), scopePredicate));
    const attemptNo = (row?.maxAttempt ?? 0) + 1;
    const stageAttemptId = ulid();

    try {
      await this.db.insert(stageAttempt).values({
        id: stageAttemptId,
        stageExecutionId: ctx.stageExecutionId,
        stageItemId: ctx.stageItemId,
        attemptNo,
        outcome: 'success', // provisional; overwritten by fetchAndFinalize/recordFailure/etc.
        resolvedInputs: {},
        phase: 'created',
        actor: 'engine',
      });
      const started = { ...ctx, attemptNo, stageAttemptId };
      await this.events.record(started, 'info', 'attempt.started', `Attempt ${attemptNo} started`, {
        attemptNo,
        ...(ctx.itemIndex !== undefined && { item: ctx.itemIndex + 1 }),
      });
      return started;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const [existing] = await this.db
        .select({ id: stageAttempt.id })
        .from(stageAttempt)
        .where(
          and(
            eq(stageAttempt.stageExecutionId, ctx.stageExecutionId),
            scopePredicate,
            eq(stageAttempt.attemptNo, attemptNo),
          ),
        )
        .limit(1);
      if (!existing) throw err;
      return { ...ctx, attemptNo, stageAttemptId: existing.id };
    }
  }

  /** Attempts with one of `outcomes` in the stage's (or item's) CURRENT
   * round — the source for every retry cap (`retryLimit` via
   * `CONSUMES_RETRY_LIMIT`, `qc.maxAttempts`, `checkMaxAttempts`, infra).
   * A round starts over after a human rejection of this scope's output
   * (attempts after the latest `rejected` row) and after any invalidation —
   * manual retry or a routed rejection — which clears
   * `stage_execution.startedAt` for `beginAttempt` to restamp. Without that
   * reset a manually retried stage would inherit an already-spent cap and
   * fail on its first rejection. */
  async countRoundAttempts(
    stageExecutionId: string,
    outcomes: readonly AttemptOutcome[],
    stageItemId?: string,
  ): Promise<number> {
    const scopePredicate = stageItemId
      ? eq(stageAttempt.stageItemId, stageItemId)
      : isNull(stageAttempt.stageItemId);
    const [lastRejection] = await this.db
      .select({ attemptNo: sql<number>`coalesce(max(${stageAttempt.attemptNo}), 0)::int` })
      .from(stageAttempt)
      .where(
        and(
          eq(stageAttempt.stageExecutionId, stageExecutionId),
          scopePredicate,
          eq(stageAttempt.outcome, 'rejected'),
        ),
      );
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(stageAttempt)
      .innerJoin(stageExecution, eq(stageAttempt.stageExecutionId, stageExecution.id))
      .where(
        and(
          eq(stageAttempt.stageExecutionId, stageExecutionId),
          scopePredicate,
          inArray(stageAttempt.outcome, [...outcomes]),
          gt(stageAttempt.attemptNo, lastRejection?.attemptNo ?? 0),
          sql`(${stageExecution.startedAt} is null or ${stageAttempt.createdAt} >= ${stageExecution.startedAt})`,
        ),
      );
    return row?.count ?? 0;
  }

  private idempotencyKey(ctx: StageAttemptContext, itemIndex?: number): string {
    return createHash('sha256')
      .update(`${ctx.stageExecutionId}:${ctx.attemptNo}:${itemIndex ?? 0}`)
      .digest('hex');
  }

  private async loadRunInputs(runId: string): Promise<Record<string, unknown>> {
    const [row] = await this.db
      .select({ inputs: run.inputs })
      .from(run)
      .where(eq(run.id, runId))
      .limit(1);
    if (!row) throw new Error(`StageRunnerService: run ${runId} not found`);
    return row.inputs as Record<string, unknown>;
  }

  /** §6.2 — `run.assetBindings`, snapshotted once at `RunService.start()`;
   * fed into `BindingScope` so `{from:'asset'}` refs resolve without
   * `BindingResolverService` ever touching the live `asset` table. */
  private async loadAssetBindings(
    runId: string,
  ): Promise<Record<string, { blobId: string; kind: string }>> {
    const [row] = await this.db
      .select({ assetBindings: run.assetBindings })
      .from(run)
      .where(eq(run.id, runId))
      .limit(1);
    if (!row) throw new Error(`StageRunnerService: run ${runId} not found`);
    return row.assetBindings as Record<string, { blobId: string; kind: string }>;
  }

  private async loadRoleBindings(runId: string): Promise<Record<string, RoleBinding>> {
    const [row] = await this.db
      .select({ roleBindings: run.roleBindings })
      .from(run)
      .where(eq(run.id, runId))
      .limit(1);
    if (!row) throw new Error(`StageRunnerService: run ${runId} not found`);
    return row.roleBindings as Record<string, RoleBinding>;
  }

  private async resolveBindings(
    stage: StageDef,
    runId: string,
    prevStageKey: string | undefined,
    itemIndex?: number,
  ): Promise<ResolvedBindings> {
    const [inputs, assetBindings, roleBindings] = await Promise.all([
      this.loadRunInputs(runId),
      this.loadAssetBindings(runId),
      this.loadRoleBindings(runId),
    ]);
    return this.bindingResolver.resolveAll(stage, {
      runId,
      prevStageKey,
      inputs,
      assetBindings,
      roleBindings,
      stageKey: stage.key,
      itemIndex,
    });
  }

  /** §3.8.1's critique log — derived from prior `stage_attempt` rows'
   * existing `checkResults`/`qcVerdict` columns, no new table/column. Human
   * rejection notes (`reviewNote`, §10.5) are deliberately left out here — a
   * future `rejected`-outcome branch slots in without restructuring this. */
  async loadCritiqueLog(
    stageExecutionId: string,
    beforeAttemptNo: number,
    stageItemId?: string,
  ): Promise<string> {
    const scopePredicate = stageItemId
      ? eq(stageAttempt.stageItemId, stageItemId)
      : isNull(stageAttempt.stageItemId);
    const [execution] = await this.db
      .select({ runId: stageExecution.runId, stageKey: stageExecution.stageKey })
      .from(stageExecution)
      .where(eq(stageExecution.id, stageExecutionId))
      .limit(1);
    if (!execution) throw new Error(`Stage execution ${stageExecutionId} not found`);
    const rows = await this.db
      .select({
        attemptNo: stageAttempt.attemptNo,
        outcome: stageAttempt.outcome,
        checkResults: stageAttempt.checkResults,
        qcVerdict: stageAttempt.qcVerdict,
      })
      .from(stageAttempt)
      .where(
        and(
          eq(stageAttempt.stageExecutionId, stageExecutionId),
          scopePredicate,
          lt(stageAttempt.attemptNo, beforeAttemptNo),
        ),
      )
      .orderBy(asc(stageAttempt.attemptNo));

    const lines: string[] = [];
    for (const row of rows) {
      if (row.outcome === 'check_failed') {
        const results = (row.checkResults as CheckResult[] | null) ?? [];
        const failed = results
          .filter((r) => !r.pass)
          .map((r) => `- ${r.name}${r.message ? `: ${r.message}` : ''}`);
        lines.push(`Attempt ${row.attemptNo} failed these checks:\n${failed.join('\n')}`);
      } else if (row.outcome === 'qc_failed') {
        const verdict = row.qcVerdict as QcVerdict | null;
        lines.push(`Attempt ${row.attemptNo} was rejected by QC: ${verdict?.critique ?? ''}`);
        // A clip list names the clips to make again; the stage keeps the rest.
        if (verdict?.failedClips?.length) {
          lines.push(`Clips to make again (their index): ${verdict.failedClips.join(', ')}`);
        }
      }
    }
    const routed = await this.db
      .select({ reviewNote: stageAttempt.reviewNote })
      .from(stageAttempt)
      .innerJoin(stageExecution, eq(stageAttempt.stageExecutionId, stageExecution.id))
      .where(
        and(
          eq(stageExecution.runId, execution.runId),
          eq(stageAttempt.outcome, 'rejected'),
          eq(stageAttempt.critiqueTargetStageKey, execution.stageKey),
        ),
      )
      .orderBy(asc(stageAttempt.createdAt));
    for (const rejection of routed) {
      lines.push(
        `A human reviewer rejected the output: ${rejection.reviewNote ?? 'No note provided'}`,
      );
    }
    return lines.join('\n');
  }

  private buildExecCtx(
    stage: StageDef,
    ctx: StageAttemptContext,
    effective: EffectiveStageConfig,
    bindings: ResolvedBindings,
    renderedPrompt?: string,
    resources?: Awaited<ReturnType<TimelineResourceResolverService['resolve']>>,
    systemPrompt?: string,
  ) {
    return {
      runId: ctx.runId,
      stageExecutionId: ctx.stageExecutionId,
      stageKey: ctx.stageKey,
      attemptNo: ctx.attemptNo,
      itemIndex: ctx.itemIndex,
      layer: { format: effective.layer.format },
      // §7.2 TODO: this should be a ProviderClient scoped to the effective
      // model pin, not raw config on ctx.config — carried over from phase 1
      // as a deliberate shortcut; changing it is a capability-contract
      // change, out of phase-2 scope.
      config: { ...effective.capabilityConfig, ...effective.model },
      slots: bindings.slots,
      context: bindings.context,
      files: collectFileInputs(bindings.context, stage.attach ?? []),
      renderedPrompt,
      systemPrompt,
      output: stage.output,
      idempotencyKey: this.idempotencyKey(ctx, ctx.itemIndex),
      logger: {
        log: (msg: string) => void this.events.record(ctx, 'info', 'capability.log', msg),
        error: (msg: string, err?: unknown) =>
          void this.events.record(ctx, 'error', 'capability.log', msg, {
            error: err instanceof Error ? err.message : err,
          }),
      },
      ...(resources && { resources }),
    };
  }

  /**
   * §11.1/§11.4 — estimates cost, reserves against run/stage caps, then
   * submits. Phase transitions are each their own committed write (not
   * bundled into one update at the end): a crash between any two of them
   * leaves `stage_attempt.phase` at an accurate checkpoint for
   * `budget.sweep` (phase-3 chunk 3) to classify correctly. `stage.execute`
   * runs with `retries: 0`, so this whole method is NOT replayed by
   * Inngest on a mid-method crash the way a `retries > 0` step's callback
   * would be — but `reserve()` itself is still idempotent per its own
   * doc comment, since a *different* kind of replay (a resumed run
   * re-entering this stage after `budget_blocked`) does call this again
   * for a fresh attempt, not the same one.
   */
  async reserveAndSubmit(
    stage: StageDef,
    ctx: StageAttemptContext,
    prevStageKey: string | undefined,
    effective: EffectiveStageConfig,
  ): Promise<SubmitOutcome> {
    const capability = this.capabilities.get(stage.capability);
    const bindings = await this.resolveBindings(stage, ctx.runId, prevStageKey, ctx.itemIndex);
    const priorCritique = await this.loadCritiqueLog(
      ctx.stageExecutionId,
      ctx.attemptNo,
      ctx.stageItemId,
    );
    const templateScope = {
      ...bindings.slots,
      ...promptScopeWithRoles(bindings.context, stage.attach ?? []),
      priorCritique,
    };
    const outputInstructions =
      stage.output.kind === 'text' || stage.output.kind === 'data'
        ? stage.output.instructions
        : undefined;
    const isLlmStage = capability.modality === 'text';
    const renderedPrompt = renderStagePrompt(
      stage.instructions?.template,
      outputInstructions,
      templateScope,
      stage.output.kind === 'data' ? 'data' : 'text',
      isLlmStage
        ? { errorReply: true, attachments: collectFileInputs(bindings.context, stage.attach ?? []) }
        : undefined,
    );
    const resources =
      stage.capability === 'timeline.render' && bindings.slots.timeline
        ? await this.timelineResources.resolve(ctx.runId, bindings.slots.timeline)
        : undefined;
    const unpreparedExecCtx = this.buildExecCtx(
      stage,
      ctx,
      effective,
      bindings,
      renderedPrompt,
      resources,
      stage.instructions?.system,
    );
    const execCtx = capability.prepare?.(unpreparedExecCtx) ?? unpreparedExecCtx;

    // Persisted before submit so a failed submit still shows what was sent.
    await this.db
      .update(stageAttempt)
      .set({ renderedPrompt: execCtx.renderedPrompt, resolvedInputs: bindings.provenance })
      .where(eq(stageAttempt.id, ctx.stageAttemptId));
    await this.events.record(ctx, 'debug', 'inputs.resolved', 'Inputs resolved', {
      provenance: bindings.provenance,
    });
    if (execCtx.renderedPrompt !== undefined || execCtx.systemPrompt !== undefined) {
      await this.events.record(
        ctx,
        'info',
        'prompt.rendered',
        `Prompt rendered (${execCtx.renderedPrompt?.length ?? 0} chars)`,
        { system: execCtx.systemPrompt, prompt: execCtx.renderedPrompt },
      );
    }
    if (effective.model) {
      await this.events.record(
        ctx,
        'info',
        'model.selected',
        `Using ${effective.model.provider}/${effective.model.modelId}`,
        effective.model,
      );
    }

    const costEstimate = await capability.estimateCost(execCtx);
    const reserved = await this.ledger.reserve({
      runId: ctx.runId,
      stageKey: stage.key,
      stageAttemptId: ctx.stageAttemptId,
      category: 'stage_output',
      ceilingUsd: costEstimate.ceilingUsd,
      stageCapUsd: effective.budget?.stageCapUsd,
      preSubmitTtlSec: this.engineConfig.preSubmitTtlSec,
    });

    if (!reserved.ok) {
      // Phase stays 'created' — per §11.4's table, nothing reached a
      // provider, so there is nothing for the sweep to release either.
      await this.db
        .update(stageAttempt)
        .set({ outcome: reserved.reason === 'run_not_running' ? 'cancelled' : 'budget_blocked' })
        .where(eq(stageAttempt.id, ctx.stageAttemptId));
      if (reserved.reason === 'run_not_running') {
        await this.finishAttempt(ctx, 'info', 'cancelled', 'Run is no longer running');
        return { outcome: 'run_not_running' };
      }
      await this.finishAttempt(
        ctx,
        'warn',
        'budget_blocked',
        `Budget blocked (${reserved.reason === 'stage_cap_exceeded' ? 'stage' : 'run'} cap)`,
        { reason: reserved.reason, costEstimate },
      );
      return { outcome: 'budget_blocked', reason: reserved.reason };
    }
    await this.events.record(
      ctx,
      'debug',
      'budget.reserved',
      `Reserved up to $${costEstimate.ceilingUsd.toFixed(4)}`,
      costEstimate,
    );

    await this.db
      .update(stageAttempt)
      .set({ phase: 'reserved' })
      .where(eq(stageAttempt.id, ctx.stageAttemptId));
    await this.db
      .update(stageAttempt)
      .set({ phase: 'submitting' })
      .where(eq(stageAttempt.id, ctx.stageAttemptId));

    const handle = await capability.submit(execCtx);

    await this.ledger.markSubmitted(
      reserved.reservationId,
      effective.polling.maxWaitSec + this.engineConfig.fetchAllowanceSec,
    );

    await this.db
      .update(stageAttempt)
      .set({
        phase: 'submitted',
        idempotencyKey: execCtx.idempotencyKey,
        renderedPrompt: execCtx.renderedPrompt,
        jobHandle: handle,
        resolvedInputs: bindings.provenance,
      })
      .where(eq(stageAttempt.id, ctx.stageAttemptId));
    await this.events.record(ctx, 'info', 'job.submitted', `Submitted to ${handle.providerId}`, {
      handle,
    });

    return { outcome: 'submitted', handle };
  }

  async pollOnce(
    stage: StageDef,
    handle: JobHandle,
    ctx?: StageAttemptContext,
  ): Promise<JobStatus> {
    const capability = this.capabilities.get(stage.capability);
    const status = await capability.poll(handle);
    // A job that keeps its own deadline may run far past `polling.maxWaitSec`,
    // which is all the reservation's expiry allowed for: keep the reservation
    // alive for as long as the provider says the job may, so the budget sweep
    // doesn't settle (and mark the attempt timed out) under a job that is
    // still working.
    if (ctx && !status.done && status.deadlineMs !== undefined) {
      const reservationId = await this.ledger.reservationIdFor(ctx.stageAttemptId);
      await this.ledger.extendReservation(
        reservationId,
        status.deadlineMs + this.engineConfig.fetchAllowanceSec * 1000,
      );
    }
    return status;
  }

  /** Poll exhausted without `status.done` — §13's backoff loop calls this
   * instead of silently falling through to `fetchAndFinalize`. Cancels the
   * job (best-effort), records a terminal `provider_timeout` attempt row.
   * Does not touch `stage_execution` — the caller decides whether to retry
   * or fail the stage, same as `check_failed`/`qc_failed`. */
  async recordProviderTimeout(
    stage: StageDef,
    ctx: StageAttemptContext,
    handle: JobHandle,
  ): Promise<void> {
    const capability = this.capabilities.get(stage.capability);
    await capability.cancel?.(handle);
    // §11.3 — the engine stopped polling without definitive information: a
    // provisional actual at the full ceiling, not a release. Closes a gap
    // phase 2 left open (the reservation would otherwise sit until
    // budget.sweep found it, phase-3 chunk 3, even though the engine
    // already knows enough to settle now.
    const reservationId = await this.ledger.reservationIdFor(ctx.stageAttemptId);
    await this.ledger.settleProvisional({
      runId: ctx.runId,
      stageKey: ctx.stageKey,
      stageAttemptId: ctx.stageAttemptId,
      reservationId,
    });
    await this.db
      .update(stageAttempt)
      .set({ outcome: 'provider_timeout', phase: 'settled' })
      .where(eq(stageAttempt.id, ctx.stageAttemptId));
    await this.finishAttempt(
      ctx,
      'warn',
      'provider_timeout',
      'Provider did not finish within the polling window; job cancelled',
    );
  }

  /** A self-timed provider job (browser providers) ran past its own deadline:
   * cancels it, settles the reservation like a timeout, and records an
   * infrastructure error so the loop retries without spending `retryLimit`. */
  async recordProviderStall(
    stage: StageDef,
    ctx: StageAttemptContext,
    handle: JobHandle,
    reason: string,
  ): Promise<void> {
    const capability = this.capabilities.get(stage.capability);
    await capability.cancel?.(handle);
    const reservationId = await this.ledger.reservationIdFor(ctx.stageAttemptId);
    await this.ledger.settleProvisional({
      runId: ctx.runId,
      stageKey: ctx.stageKey,
      stageAttemptId: ctx.stageAttemptId,
      reservationId,
    });
    await this.recordInfraError(ctx, reason);
  }

  /** §11.3 — a provider-reported job failure before any billed work: a
   * confirmed non-billing failure, released rather than booked as spend.
   * Called from stage-execute.fn.ts right before the throw that hands the
   * outcome off to the surrounding retry/failure handling. */
  async settleFailedPoll(ctx: StageAttemptContext): Promise<void> {
    const reservationId = await this.ledger.reservationIdFor(ctx.stageAttemptId);
    await this.ledger.settleRelease({
      runId: ctx.runId,
      stageKey: ctx.stageKey,
      stageAttemptId: ctx.stageAttemptId,
      reservationId,
    });
  }

  /** A poll can come back `failed` because the run was cancelled out from
   * under it — `RunCancellationService.settleOutstanding` cancels the
   * provider job directly, racing this same attempt's own poll loop. That
   * race must not read as a genuine provider failure: mirrors
   * `fetchAndFinalize`'s own not-running check (§11's "every non-RUNNING
   * state still discards the output"), marking this attempt `cancelled`
   * (idempotent — `settleOutstanding` may have already done so) instead of
   * letting the caller fail the stage over what is really just a cancel. */
  async stopIfRunNotRunning(ctx: StageAttemptContext): Promise<boolean> {
    const state = await this.getRunState(ctx.runId);
    if (state === 'RUNNING' || state === 'PAUSED_MANUAL') return false;
    await this.db
      .update(stageAttempt)
      .set({ outcome: 'cancelled', phase: 'settled' })
      .where(eq(stageAttempt.id, ctx.stageAttemptId));
    return true;
  }

  async recordInfraError(ctx: StageAttemptContext, reason: string): Promise<void> {
    await this.db
      .update(stageAttempt)
      .set({ outcome: 'infra_error', phase: 'settled', reviewNote: reason })
      .where(eq(stageAttempt.id, ctx.stageAttemptId));
    await this.finishAttempt(ctx, 'error', 'infra_error', `Infrastructure error: ${reason}`, {
      reason,
    });
  }

  async fetchAndFinalize(
    stage: StageDef,
    ctx: StageAttemptContext,
    handle: JobHandle,
    prevStageKey: string | undefined,
    effective: EffectiveStageConfig,
  ): Promise<FetchAndFinalizeResult> {
    const capability = this.capabilities.get(stage.capability);
    const bindings = await this.resolveBindings(stage, ctx.runId, prevStageKey, ctx.itemIndex);
    const resources =
      stage.capability === 'timeline.render' && bindings.slots.timeline
        ? await this.timelineResources.resolve(ctx.runId, bindings.slots.timeline)
        : undefined;
    const execCtx = this.buildExecCtx(stage, ctx, effective, bindings, undefined, resources);
    const result = await capability.fetch(handle, execCtx);
    await this.events.record(
      ctx,
      'info',
      'job.completed',
      `Provider finished ($${result.costUsd.toFixed(4)})`,
      {
        costUsd: result.costUsd,
        repro: result.repro,
        ...(result.attachments?.length && { attachments: result.attachments.length }),
        ...(result.providerMeta && { provider: result.providerMeta }),
      },
    );
    const output =
      stage.output.kind === 'timeline'
        ? this.timelineHandles.canonicalize(result.output, bindings.provenance)
        : result.output;

    const [runRow] = await this.db.select().from(run).where(eq(run.id, ctx.runId)).limit(1);
    if (!runRow) throw new Error(`StageRunnerService: run ${ctx.runId} not found`);
    const [channelRow] = await this.db
      .select({ ownerId: channel.ownerId })
      .from(channel)
      .where(eq(channel.id, runRow.channelId))
      .limit(1);

    const rawResponseRef = await this.blobs.writeRawResponse({
      ownerId: channelRow?.ownerId ?? 'local',
      channelId: runRow.channelId,
      runId: ctx.runId,
      attemptId: ctx.stageAttemptId,
      payload: result,
    });

    if (result.modelError) {
      // The model declined the task; retrying the same inputs won't change
      // that, so the stage fails with its message. The call was still billed.
      const reason = `Model reported ${result.modelError.code}: ${result.modelError.message}`;
      await this.ledger.settleSuccess({
        runId: ctx.runId,
        stageKey: stage.key,
        stageAttemptId: ctx.stageAttemptId,
        reservationId: await this.ledger.reservationIdFor(ctx.stageAttemptId),
        actualUsd: result.costUsd,
      });
      await this.db
        .update(stageAttempt)
        .set({
          outcome: 'provider_error',
          phase: 'settled',
          rawResponseRef,
          costUsd: fromUsd(result.costUsd),
          reviewNote: reason,
        })
        .where(eq(stageAttempt.id, ctx.stageAttemptId));
      await this.finishAttempt(ctx, 'error', 'provider_error', reason, {
        modelError: result.modelError,
      });
      return { outcome: 'model_error', reason };
    }

    if (result.deferUntil) {
      // Out of provider quota: nothing to persist. The attempt is parked as
      // `deferred` (it spends no retry) and the run pauses until the quota
      // resets; the next attempt picks up where this one stopped.
      await this.ledger.settleSuccess({
        runId: ctx.runId,
        stageKey: stage.key,
        stageAttemptId: ctx.stageAttemptId,
        reservationId: await this.ledger.reservationIdFor(ctx.stageAttemptId),
        actualUsd: result.costUsd,
      });
      await this.db
        .update(stageAttempt)
        .set({
          outcome: 'deferred',
          phase: 'settled',
          rawResponseRef,
          costUsd: fromUsd(result.costUsd),
          reviewNote: `Out of quota until ${result.deferUntil}`,
        })
        .where(eq(stageAttempt.id, ctx.stageAttemptId));
      await this.finishAttempt(
        ctx,
        'warn',
        'deferred',
        `Out of quota; resuming at ${result.deferUntil}`,
        { resumeAt: result.deferUntil },
      );
      return { outcome: 'deferred', resumeAt: result.deferUntil };
    }

    const isClipList = stage.output.kind === 'media.video_list';
    const mediaOutput =
      stage.output.kind.startsWith('media.') && !isClipList
        ? (output as import('@reelcraft/shared').MediaSource)
        : undefined;
    const clipOutputs = isClipList ? (output as { clips: Array<ClipOutput> }).clips : undefined;
    const fileOutput =
      stage.output.kind === 'file.subtitles'
        ? (output as import('@reelcraft/shared').FileSource)
        : undefined;
    let persistedMedia: Awaited<ReturnType<MediaArtifactService['persist']>> | undefined;
    try {
      persistedMedia = mediaOutput
        ? await this.mediaArtifacts.persist({
            ownerId: channelRow?.ownerId ?? 'local',
            channelId: runRow.channelId,
            runId: ctx.runId,
            source: mediaOutput,
          })
        : undefined;
    } finally {
      if (mediaOutput?.localPath) await capability.cleanup?.(handle);
    }
    const persistedClips: PersistedClip[] = [];
    try {
      for (const clip of clipOutputs ?? []) {
        const persisted = await this.mediaArtifacts.persist({
          ownerId: channelRow?.ownerId ?? 'local',
          channelId: runRow.channelId,
          runId: ctx.runId,
          source: clip.source,
        });
        persistedClips.push({ clip, ...persisted });
      }
    } finally {
      if (clipOutputs?.length) await capability.cleanup?.(handle);
    }
    let persistedFile: Awaited<ReturnType<FileArtifactService['persist']>> | undefined;
    try {
      persistedFile = fileOutput
        ? await this.fileArtifacts.persist({
            ownerId: channelRow?.ownerId ?? 'local',
            channelId: runRow.channelId,
            runId: ctx.runId,
            source: fileOutput,
          })
        : undefined;
    } finally {
      if (fileOutput?.localPath) await capability.cleanup?.(handle);
    }
    const kind =
      stage.output.kind === 'data'
        ? 'data'
        : stage.output.kind === 'text'
          ? 'text'
          : stage.output.kind;
    // Generate Speech keeps the text it spoke (`{text}`, like a text output) so
    // checks such as `wpm` and quality control can compare it with the audio,
    // and the word timings when it made them (`writes: { timings: 'timing' }`).
    const slotText = unwrapText('text', bindings.slots.text);
    const spokenText =
      stage.capability === 'audio.speech' && typeof slotText === 'string' ? slotText : undefined;
    const data =
      kind === 'text'
        ? { text: output }
        : kind === 'data' || kind === 'timeline'
          ? output
          : kind === 'media.video_list'
            ? {
                clips: persistedClips.map(({ clip, blobId, probe }) => ({
                  index: clip.index,
                  label: clip.label ?? null,
                  prompt: clip.prompt ?? null,
                  filename: clipFilename(clip),
                  blobId,
                  probe,
                })),
              }
            : spokenText !== undefined
              ? { text: spokenText, ...(result.timing && { timing: result.timing }) }
              : undefined;
    const artifactId = await this.artifacts.recordAttemptArtifact({
      runId: ctx.runId,
      producerStageKey: stage.key,
      itemIndex: ctx.itemIndex,
      kind,
      data,
      ...(persistedMedia && { blobId: persistedMedia.blobId, probe: persistedMedia.probe }),
      ...(persistedFile && {
        blobId: persistedFile.blobId,
        data: { format: fileOutput!.format },
      }),
      ...(stage.output.kind === 'data' && {
        schemaHash: this.schemaValidator.hashOf(stage.output.schema),
      }),
      reproLevel: result.repro.level,
      repro: result.repro,
      costUsd: result.costUsd,
    });
    if (persistedClips.length) {
      await this.artifactAttachments.linkClips(
        artifactId,
        persistedClips.map(({ clip, blobId }) => ({
          blobId,
          filename: clipFilename(clip),
          mime: clip.source.mime ?? 'video/mp4',
        })),
      );
    }
    if (result.attachments?.length) {
      await this.artifactAttachments.persist({
        ownerId: channelRow?.ownerId ?? 'local',
        channelId: runRow.channelId,
        runId: ctx.runId,
        artifactId,
        attachments: result.attachments,
      });
    }

    // The provider call cost money and the artifact is born stale (§3.9.1)
    // regardless of what checks/QC decide below — both are unconditional.
    // §11.3 — settles the reservation `reserveAndSubmit` made, at the true
    // cost rather than the ceiling.
    const reservationId = await this.ledger.reservationIdFor(ctx.stageAttemptId);
    await this.ledger.settleSuccess({
      runId: ctx.runId,
      stageKey: stage.key,
      stageAttemptId: ctx.stageAttemptId,
      reservationId,
      actualUsd: result.costUsd,
    });

    await this.db
      .update(stageAttempt)
      .set({ phase: 'settled', artifactId, rawResponseRef, costUsd: fromUsd(result.costUsd) })
      .where(eq(stageAttempt.id, ctx.stageAttemptId));

    return this.judgeAndFinalize({
      stage,
      ctx,
      effective,
      prevStageKey,
      bindings,
      candidate: {
        kind,
        data,
        output,
        artifactId,
        costUsd: result.costUsd,
        ...(persistedMedia && {
          media: {
            storageKey: persistedMedia.storageKey,
            probe: persistedMedia.probe,
            mime: mediaOutput?.mime,
          },
        }),
        clips: persistedClips.map(({ clip, storageKey }) => ({
          sourceKey: storageKey,
          mime: clip.source.mime ?? 'video/mp4',
          index: clip.index,
          label: clip.label || `Clip ${clip.index}`,
        })),
      },
    });
  }

  /** Everything after the candidate artifact is stored: checks, quality
   * control, then finalize (or hand to a human). Split from `fetchAndFinalize`
   * so "Retry QC" can run it again on a stored candidate without
   * regenerating it. */
  private async judgeAndFinalize(p: {
    stage: StageDef;
    ctx: StageAttemptContext;
    effective: EffectiveStageConfig;
    prevStageKey: string | undefined;
    bindings: ResolvedBindings;
    candidate: Candidate;
  }): Promise<FetchAndFinalizeResult> {
    const { stage, ctx, effective, prevStageKey, bindings, candidate } = p;
    const { kind, data, output, artifactId } = candidate;
    const persistedMedia = candidate.media;
    const checkArtifact: CheckArtifact = {
      kind,
      data,
      ...(persistedMedia && { probe: persistedMedia.probe }),
    };
    const resolvedRefs: Array<Record<string, RefEnvelope>> = [];
    const checkProvenance: ResolvedBindings['provenance'] = {};
    for (const [checkIndex, check] of stage.checks.entries()) {
      if (check.type === 'script' && check.refs) {
        const resolved = await this.bindingResolver.resolveRefEnvelopes(check.refs, {
          runId: ctx.runId,
          prevStageKey,
          inputs: await this.loadRunInputs(ctx.runId),
          assetBindings: await this.loadAssetBindings(ctx.runId),
          stageKey: stage.key,
          itemIndex: ctx.itemIndex,
          iterateOverValue: bindings.iterateOverValue,
        });
        resolvedRefs.push(resolved.refs);
        for (const [name, provenance] of Object.entries(resolved.provenance)) {
          checkProvenance[`checks.${checkIndex}.refs.${name}`] = provenance;
        }
      } else {
        resolvedRefs.push({});
      }
    }
    await this.db
      .update(stageAttempt)
      .set({ resolvedInputs: { ...bindings.provenance, ...checkProvenance } })
      .where(eq(stageAttempt.id, ctx.stageAttemptId));

    const checkResults = await this.checks.run({
      checks: stage.checks,
      artifact: checkArtifact,
      resolvedRefs,
      ...(stage.output.kind === 'data' && { outputSchema: stage.output.schema }),
    });
    if (stage.output.kind === 'timeline') {
      const config = effective.capabilityConfig as {
        allowGaps?: boolean;
        toleranceSec?: number;
      };
      checkResults.unshift(
        ...(await this.timelineChecks.run({
          runId: ctx.runId,
          timeline: output,
          allowGaps: config.allowGaps,
          toleranceSec: config.toleranceSec,
          aspectRatio: effective.layer.format?.aspectRatio,
        })),
      );
    }
    // Video is audio-bearing by default. A stage must explicitly request
    // `forbidden` or `optional` to accept a silent provider result.
    if (stage.output.kind === 'media.video' && persistedMedia) {
      const audioPolicy = stage.output.constraints?.audio ?? 'required';
      const hasAudio = persistedMedia.probe.streams.some((stream) => stream.type === 'audio');
      if ((audioPolicy === 'required' && !hasAudio) || (audioPolicy === 'forbidden' && hasAudio)) {
        checkResults.push({
          name: 'audio_constraint',
          kind: 'builtin',
          pass: false,
          fault: 'artifact',
          message: `video audio is ${hasAudio ? 'present' : 'absent'} but output requires ${audioPolicy}`,
        });
      }
    }

    const failedChecks = checkResults.filter((r) => !r.pass);
    if (checkResults.length > 0) {
      await this.events.record(
        ctx,
        failedChecks.length ? 'warn' : 'info',
        'checks.result',
        `${checkResults.length - failedChecks.length}/${checkResults.length} checks passed`,
        { checks: checkResults },
      );
    }
    if (failedChecks.length) {
      await this.db
        .update(stageAttempt)
        .set({ outcome: 'check_failed', checkResults })
        .where(eq(stageAttempt.id, ctx.stageAttemptId));
      await this.finishAttempt(
        ctx,
        'warn',
        'check_failed',
        `Checks failed: ${failedChecks.map((r) => r.name).join(', ')}`,
        { failed: failedChecks },
      );
      return { outcome: 'check_failed', checkResults };
    }

    if (stage.qc && effective.qc) {
      // §10.4 — "qc.capUsd is spent and an artifact cannot be judged...
      // does not spend past the cap": a cumulative-spend check against
      // confirmed qc-category ledger entries, not a reservation — see the
      // Decision note in the phase-3 plan for why QC's synchronous,
      // non-reserved execution model doesn't get the reserve/settle
      // treatment stage output does.
      if (effective.qc.capUsd !== undefined) {
        const qcSpent = await this.ledger.qcSpentUsd(ctx.runId, stage.key);
        if (qcSpent >= effective.qc.capUsd) {
          await this.db
            .update(stageAttempt)
            .set({ outcome: 'qc_budget_exhausted', checkResults })
            .where(eq(stageAttempt.id, ctx.stageAttemptId));
          await this.finishAttempt(ctx, 'warn', 'qc_budget_exhausted', 'QC budget exhausted', {
            qcSpentUsd: qcSpent,
            capUsd: effective.qc.capUsd,
          });
          return { outcome: 'qc_budget_exhausted', checkResults };
        }
      }

      let qcMedia =
        stage.output.kind === 'media.image' && persistedMedia
          ? { sourceKey: persistedMedia.storageKey, mime: persistedMedia.mime ?? 'image/png' }
          : undefined;
      // "Include transcript" on an audio output: the judge listens to the
      // file when its model accepts audio, otherwise Deepgram transcribes it.
      let qcTranscript: string | undefined;
      if (
        stage.qc.media?.includeTranscript &&
        stage.output.kind === 'media.audio' &&
        persistedMedia
      ) {
        const audioMime = persistedMedia.mime ?? 'audio/mpeg';
        const audioMode = await this.qcAudio.mode(effective.qc.judge);
        let audioError: string | undefined;
        if (audioMode.mode === 'attach') {
          qcMedia = { sourceKey: persistedMedia.storageKey, mime: audioMime };
        } else if (audioMode.mode === 'transcribe') {
          try {
            const transcribed = await this.qcAudio.transcribe(persistedMedia.storageKey, audioMime);
            qcTranscript = transcribed.transcript;
            await this.ledger.recordActual({
              runId: ctx.runId,
              stageKey: stage.key,
              stageAttemptId: ctx.stageAttemptId,
              category: 'qc',
              amountUsd: transcribed.costUsd,
            });
          } catch (error) {
            audioError = `could not transcribe the audio: ${(error as Error).message}`;
          }
        } else {
          audioError = audioMode.reason;
        }
        if (audioError)
          return this.holdForQcRetry(stage, ctx, checkResults, audioError, artifactId);
      }
      // A clip list is judged as every clip, in order, as video files.
      const qcClips = candidate.clips;
      const qcOutcome = await this.runQcWithRetries(
        stage.qc,
        effective.qc,
        ctx,
        checkArtifact,
        bindings,
        qcMedia,
        qcTranscript,
        qcClips,
      );

      if (qcOutcome.status === 'error') {
        return this.holdForQcRetry(stage, ctx, checkResults, qcOutcome.reason, artifactId);
      }

      await this.ledger.recordActual({
        runId: ctx.runId,
        stageKey: stage.key,
        stageAttemptId: ctx.stageAttemptId,
        category: 'qc',
        amountUsd: qcOutcome.costUsd,
      });

      if (qcOutcome.status === 'failed') {
        await this.db
          .update(stageAttempt)
          .set({ outcome: 'qc_failed', checkResults, qcVerdict: qcOutcome.verdict })
          .where(eq(stageAttempt.id, ctx.stageAttemptId));
        await this.finishAttempt(
          ctx,
          'warn',
          'qc_failed',
          `QC rejected the output: ${qcOutcome.verdict.critique}`,
        );
        return { outcome: 'qc_failed', checkResults, qcVerdict: qcOutcome.verdict };
      }

      await this.db
        .update(stageAttempt)
        .set({ qcVerdict: qcOutcome.verdict })
        .where(eq(stageAttempt.id, ctx.stageAttemptId));
    }

    const finalized = await this.db.transaction(async (tx) => {
      const [lockedRun] = await tx
        .select({ state: run.state })
        .from(run)
        .where(eq(run.id, ctx.runId))
        .for('update');
      // Manual pause is soft: the run flips to `PAUSED_MANUAL` immediately,
      // but an attempt that was already mid-flight when that happened is
      // allowed to finish and commit here rather than being thrown away —
      // it's already been paid for. Every other non-RUNNING state (in
      // particular CANCELLED) still discards the output.
      if (!lockedRun || (lockedRun.state !== 'RUNNING' && lockedRun.state !== 'PAUSED_MANUAL')) {
        await tx
          .update(stageAttempt)
          .set({ outcome: 'cancelled', phase: 'settled', checkResults })
          .where(eq(stageAttempt.id, ctx.stageAttemptId));
        return { outcome: 'run_not_running' as const };
      }

      if (stage.approval) {
        await this.openApprovalGate(tx, stage, ctx, checkResults);
        return { outcome: 'approval_required' as const, artifactId };
      }

      await this.artifacts.finalize(
        {
          runId: ctx.runId,
          stageExecutionId: ctx.stageExecutionId,
          producerStageKey: stage.key,
          itemIndex: ctx.itemIndex,
          newArtifactId: artifactId,
          stageItemId: ctx.stageItemId,
          costUsd: candidate.costUsd,
          applyWrites: this.memory.buildWriteCallback(stage, {
            runId: ctx.runId,
            stageKey: stage.key,
            ...(ctx.itemIndex !== undefined ? { itemIndex: ctx.itemIndex } : {}),
            kind,
            data,
            artifactId,
          }),
        },
        tx,
      );

      await tx
        .update(stageAttempt)
        .set({ outcome: 'success', checkResults })
        .where(eq(stageAttempt.id, ctx.stageAttemptId));

      // phase 7 chunk 4 — an item finalize leaves stage_execution alone
      // (Locked Decision 5/6): the stage as a whole only turns 'passed'
      // once `finishIteratingStage` runs after every item has, which also
      // sets the last item's artifact as `stage_execution.outputArtifactId`.
      if (!ctx.stageItemId) {
        await tx
          .update(stageExecution)
          .set({ state: 'passed', endedAt: new Date().toISOString() })
          .where(eq(stageExecution.id, ctx.stageExecutionId));
      }

      return { outcome: 'success' as const, artifactId };
    });
    if (finalized.outcome === 'run_not_running') {
      await this.finishAttempt(ctx, 'info', 'cancelled', 'Run stopped; output discarded');
    } else if (finalized.outcome === 'approval_required') {
      await this.finishAttempt(ctx, 'info', 'awaiting_approval', 'Output ready for review');
    } else {
      await this.finishAttempt(ctx, 'info', 'success', 'Attempt succeeded');
    }
    return finalized;
  }

  /** Quality control could not run (the judge was unreachable, stuck or
   * unparseable). The stage does not fail for that: the output is parked
   * behind the approval gate and the run pauses, so a person can approve it,
   * reject it, or retry QC once the judge is back. */
  private async holdForQcRetry(
    stage: StageDef,
    ctx: StageAttemptContext,
    checkResults: CheckResult[],
    reason: string,
    artifactId: string,
  ): Promise<FetchAndFinalizeResult> {
    const held = await this.db.transaction(async (tx) => {
      const [lockedRun] = await tx
        .select({ state: run.state })
        .from(run)
        .where(eq(run.id, ctx.runId))
        .for('update');
      if (!lockedRun || (lockedRun.state !== 'RUNNING' && lockedRun.state !== 'PAUSED_MANUAL')) {
        await tx
          .update(stageAttempt)
          .set({ outcome: 'cancelled', phase: 'settled', checkResults })
          .where(eq(stageAttempt.id, ctx.stageAttemptId));
        return false;
      }
      await this.openApprovalGate(tx, stage, ctx, checkResults, reason);
      return true;
    });
    if (!held) {
      await this.finishAttempt(ctx, 'info', 'cancelled', 'Run stopped; output discarded');
      return { outcome: 'run_not_running' };
    }
    await this.finishAttempt(
      ctx,
      'warn',
      'qc_error',
      `QC could not run: ${reason}. The run is paused: approve the output, reject it, or retry QC.`,
    );
    return { outcome: 'approval_required', artifactId };
  }

  /** The attempt a person asked to retry QC on: the newest one for this
   * stage (or item), parked by `holdForQcRetry` and released by "Retry QC". */
  async findHeldQcAttempt(
    stageExecutionId: string,
    stageItemId?: string,
  ): Promise<StageAttemptContext | undefined> {
    const [row] = await this.db
      .select({
        id: stageAttempt.id,
        attemptNo: stageAttempt.attemptNo,
        outcome: stageAttempt.outcome,
        phase: stageAttempt.phase,
        artifactId: stageAttempt.artifactId,
        stageItemId: stageAttempt.stageItemId,
        runId: stageExecution.runId,
        stageKey: stageExecution.stageKey,
      })
      .from(stageAttempt)
      .innerJoin(stageExecution, eq(stageExecution.id, stageAttempt.stageExecutionId))
      .where(
        and(
          eq(stageAttempt.stageExecutionId, stageExecutionId),
          stageItemId
            ? eq(stageAttempt.stageItemId, stageItemId)
            : isNull(stageAttempt.stageItemId),
        ),
      )
      .orderBy(desc(stageAttempt.attemptNo))
      .limit(1);
    if (!row || row.outcome !== 'qc_error' || row.phase !== 'settled' || !row.artifactId) {
      return undefined;
    }
    let itemIndex: number | undefined;
    if (row.stageItemId) {
      const [item] = await this.db
        .select({ itemIndex: stageItem.itemIndex })
        .from(stageItem)
        .where(eq(stageItem.id, row.stageItemId))
        .limit(1);
      itemIndex = item?.itemIndex;
    }
    return {
      runId: row.runId,
      stageExecutionId,
      stageKey: row.stageKey,
      attemptNo: row.attemptNo,
      stageAttemptId: row.id,
      itemIndex,
      stageItemId: row.stageItemId ?? undefined,
    };
  }

  /** "Retry QC": judges the stored candidate of a held attempt again, with
   * the same checks, judge and outcomes as the first time, but without
   * generating anything. */
  async retryHeldQc(
    stage: StageDef,
    ctx: StageAttemptContext,
    prevStageKey: string | undefined,
    effective: EffectiveStageConfig,
  ): Promise<FetchAndFinalizeResult> {
    const [attempt] = await this.db
      .select({ artifactId: stageAttempt.artifactId, costUsd: stageAttempt.costUsd })
      .from(stageAttempt)
      .where(eq(stageAttempt.id, ctx.stageAttemptId))
      .limit(1);
    if (!attempt?.artifactId) {
      throw new Error(`StageRunnerService: attempt ${ctx.stageAttemptId} has no artifact`);
    }
    const [stored] = await this.db
      .select()
      .from(artifact)
      .where(eq(artifact.id, attempt.artifactId))
      .limit(1);
    if (!stored) throw new Error(`StageRunnerService: artifact ${attempt.artifactId} not found`);

    const keyOf = async (blobId: string) => {
      const [row] = await this.db
        .select({ objectKey: blob.objectKey, mime: blob.mime })
        .from(blob)
        .where(eq(blob.id, blobId))
        .limit(1);
      if (!row) throw new Error(`StageRunnerService: blob ${blobId} not found`);
      return row;
    };
    const storedClips = (
      (
        stored.data as {
          clips?: Array<{ index: number; label: string | null; blobId: string }>;
        } | null
      )?.clips ?? []
    ).filter(() => stored.kind === 'media.video_list');
    const clips = await Promise.all(
      storedClips.map(async (clip) => {
        const file = await keyOf(clip.blobId);
        return {
          sourceKey: file.objectKey,
          mime: file.mime,
          index: clip.index,
          label: clip.label || `Clip ${clip.index}`,
        };
      }),
    );
    const mediaBlob = stored.blobId ? await keyOf(stored.blobId) : undefined;
    const bindings = await this.resolveBindings(stage, ctx.runId, prevStageKey, ctx.itemIndex);
    return this.judgeAndFinalize({
      stage,
      ctx,
      effective,
      prevStageKey,
      bindings,
      candidate: {
        kind: stored.kind as Candidate['kind'],
        data: stored.data,
        output: stored.data,
        artifactId: stored.id,
        costUsd: toUsd(attempt.costUsd),
        ...(mediaBlob && stored.probe
          ? {
              media: {
                storageKey: mediaBlob.objectKey,
                probe: stored.probe as MediaProbe,
                mime: mediaBlob.mime,
              },
            }
          : {}),
        clips,
      },
    });
  }

  /** Parks the attempt's (not yet finalized) artifact behind a human
   * approval gate — for a stage's own `approval`, and for QC hand-off. */
  private async openApprovalGate(
    tx: Tx,
    stage: StageDef,
    ctx: StageAttemptContext,
    checkResults?: CheckResult[],
    qcError?: string,
  ): Promise<void> {
    await tx
      .update(stageAttempt)
      .set({
        // A QC hold keeps `qc_error` as its outcome, so the review can offer
        // "Retry QC" next to Approve and Reject.
        outcome: qcError !== undefined ? 'qc_error' : 'awaiting_approval',
        phase: 'awaiting_approval',
        ...(qcError !== undefined && { reviewNote: qcError }),
        ...(checkResults && { checkResults }),
      })
      .where(eq(stageAttempt.id, ctx.stageAttemptId));

    if (approvalModeOf(stage) === 'stage') {
      await tx
        .update(stageExecution)
        .set({ state: 'awaiting_approval' })
        .where(eq(stageExecution.id, ctx.stageExecutionId));
      await this.humanWaits.open(tx, {
        runId: ctx.runId,
        stageExecutionId: ctx.stageExecutionId,
        kind: 'approval',
      });
      return;
    }
    // phase 7 chunk 6 — item-mode approval: the pause is scoped to this ONE
    // item. `stage_execution` is deliberately left alone (still 'running') —
    // the outer per-item loop only flips it to 'passed' once every item has,
    // via `finishIteratingStage` (Locked Decision 5/6), so it must not read
    // `awaiting_approval` while sibling items may still be pending or
    // already passed. Item mode implies `stage.iterate`, whose attempts
    // always carry a `stageItemId` — a defensive assertion, not a real branch.
    if (!ctx.stageItemId) {
      throw new Error(
        'StageRunnerService: item-mode approval requires an item-scoped attempt (stageItemId missing)',
      );
    }
    await tx
      .update(stageItem)
      .set({ state: 'awaiting_approval' })
      .where(eq(stageItem.id, ctx.stageItemId));
    await this.humanWaits.open(tx, {
      runId: ctx.runId,
      stageExecutionId: ctx.stageExecutionId,
      stageItemId: ctx.stageItemId,
      kind: 'approval',
    });
  }

  /** `qc.onExhausted: 'human_review'` — QC spent `maxAttempts` without a
   * pass, so instead of failing, the last QC-rejected output goes to a
   * human who approves it as-is or rejects it (uncapped) with a note that
   * becomes the next attempt's feedback. */
  async handOffForReview(
    stage: StageDef,
    ctx: StageAttemptContext,
  ): Promise<
    { outcome: 'approval_required'; artifactId: string } | { outcome: 'run_not_running' }
  > {
    const result = await this.db.transaction(async (tx) => {
      const [lockedRun] = await tx
        .select({ state: run.state })
        .from(run)
        .where(eq(run.id, ctx.runId))
        .for('update');
      if (!lockedRun || (lockedRun.state !== 'RUNNING' && lockedRun.state !== 'PAUSED_MANUAL')) {
        return { outcome: 'run_not_running' as const };
      }
      const [attempt] = await tx
        .select({ artifactId: stageAttempt.artifactId })
        .from(stageAttempt)
        .where(eq(stageAttempt.id, ctx.stageAttemptId))
        .limit(1);
      if (!attempt?.artifactId) {
        throw new Error(`StageRunnerService: attempt ${ctx.stageAttemptId} has no artifact`);
      }
      await this.openApprovalGate(tx, stage, ctx);
      return { outcome: 'approval_required' as const, artifactId: attempt.artifactId };
    });
    if (result.outcome === 'approval_required') {
      await this.events.record(
        ctx,
        'warn',
        'qc.handoff',
        'QC attempts exhausted; output handed to a human for review',
      );
    }
    return result;
  }

  /** §10.4 — retried up to `qcErrorRetries` times on `status:'error'` (the
   * judge call itself failed — timeout, unparseable, transport), each
   * attempt keyed by its own idempotency key so `FakeProviderAdapter` (and
   * any real idempotent adapter) can't hand back a memoized job from a
   * different attempt number. `passed`/`failed` (the judge ran and rendered
   * a verdict) never retries — only `error` does. */
  private async runQcWithRetries(
    qcDef: QcDef,
    effectiveQc: NonNullable<EffectiveStageConfig['qc']>,
    ctx: StageAttemptContext,
    artifact: CheckArtifact,
    bindings: ResolvedBindings,
    media: { sourceKey: string; mime: string } | undefined,
    transcript?: string,
    clips?: Array<{ sourceKey: string; mime: string; index: number; label: string }>,
  ): Promise<QcOutcome> {
    const envelope = buildQcEnvelope({
      criteria: qcDef.criteria,
      ...(qcDef.dimensions !== undefined && { dimensions: qcDef.dimensions }),
      artifactKind: artifact.kind,
      artifactData: artifact.data,
      ...(artifact.probe !== undefined && { artifactProbe: artifact.probe }),
      includeInputs: qcDef.includeInputs,
      slots: bindings.slots,
      context: bindings.context,
      ...(media !== undefined && { media }),
      ...(transcript !== undefined && { transcript }),
      ...(clips?.length && { clips }),
    });

    const maxAttempts = 1 + this.engineConfig.qcErrorRetries;
    let last: QcOutcome = { status: 'error', reason: 'qc never attempted', costUsd: 0 };
    for (let n = 1; n <= maxAttempts; n++) {
      last = await this.qc.run({
        envelope,
        judge: effectiveQc.judge,
        threshold: effectiveQc.threshold,
        idempotencyKey: `${ctx.stageAttemptId}:qc:${n}`,
      });
      await this.events.record(
        ctx,
        last.status === 'passed' ? 'info' : last.status === 'failed' ? 'warn' : 'error',
        'qc.result',
        last.status === 'error'
          ? `QC call ${n}/${maxAttempts} errored: ${last.reason}`
          : `QC ${last.status}`,
        last,
      );
      if (last.status !== 'error') return last;
    }
    return last;
  }

  /** The `stage_execution.state='failed'` half of `recordFailure`, for the
   * check/QC failure paths — those already wrote their own terminal
   * `stage_attempt` row (in `fetchAndFinalize`) and don't need
   * `recordFailure`'s attempt-row-writing half. */
  /** phase 7 chunk 4 — when `stageItemId` is given, the failure is this
   * item's alone: `stage_item` goes `'failed'`, `stage_execution` is left
   * untouched (another item earlier in the sequence may already be
   * 'passed', and the stage as a whole never reaches a terminal state via
   * this path — `stage.execute`'s outer loop returns `{outcome:'failed'}`
   * directly to `run.orchestrate` without a further stage_execution write). */
  async failStageExecution(
    stageExecutionId: string,
    reason: string,
    stageItemId?: string,
  ): Promise<void> {
    const [execution] = await this.db
      .select({ runId: stageExecution.runId, stageKey: stageExecution.stageKey })
      .from(stageExecution)
      .where(eq(stageExecution.id, stageExecutionId))
      .limit(1);
    if (execution) {
      await this.events.record(
        { ...execution, stageExecutionId },
        'error',
        'stage.failed',
        `${stageItemId ? 'Item' : 'Stage'} failed: ${reason}`,
        { reason },
      );
    }
    if (stageItemId) {
      await this.db
        .update(stageItem)
        .set({ state: 'failed', failure: { reason } })
        .where(eq(stageItem.id, stageItemId));
      return;
    }
    await this.db
      .update(stageExecution)
      .set({ state: 'failed', failure: { reason }, endedAt: new Date().toISOString() })
      .where(eq(stageExecution.id, stageExecutionId));
  }

  /** For a thrown exception (transport error, unexpected throw) on an
   * attempt that ISN'T the last one — the run loops to a fresh attempt, so
   * only this attempt's own row needs marking, not the stage_execution
   * (mirrors `check_failed`/`qc_failed`'s "record this attempt, decide
   * whether to continue at the caller" split). Leaving this attempt's row
   * at its provisional `outcome:'success'` placeholder forever — as an
   * earlier version of the caller's loop did on this exact path — would
   * corrupt the audit trail: a thrown-and-retried attempt would read back
   * as having succeeded. */
  async recordAttemptError(ctx: StageAttemptContext, reason: string): Promise<void> {
    await this.db
      .update(stageAttempt)
      .set({ outcome: 'provider_error', phase: 'settled', reviewNote: reason })
      .where(eq(stageAttempt.id, ctx.stageAttemptId));
    await this.finishAttempt(ctx, 'error', 'provider_error', `Attempt failed: ${reason}`, {
      reason,
    });
  }

  /** Closes an attempt in the stage log: one `attempt.finished` event with
   * the outcome and wall-clock duration, which is also written to
   * `stage_attempt.duration_ms`. */
  private async finishAttempt(
    ctx: StageAttemptContext,
    level: StageEventLevel,
    outcome: string,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    const [row] = await this.db
      .select({ createdAt: stageAttempt.createdAt })
      .from(stageAttempt)
      .where(eq(stageAttempt.id, ctx.stageAttemptId))
      .limit(1);
    const durationMs = row ? Date.now() - Date.parse(row.createdAt) : undefined;
    if (durationMs !== undefined) {
      await this.db
        .update(stageAttempt)
        .set({ durationMs })
        .where(eq(stageAttempt.id, ctx.stageAttemptId));
    }
    await this.events.record(ctx, level, 'attempt.finished', message, {
      outcome,
      durationMs,
      ...data,
    });
  }

  /** For a thrown exception on the LAST attempt — writes both halves: the
   * terminal attempt row AND the stage_execution failure. */
  async recordFailure(ctx: StageAttemptContext, reason: string): Promise<void> {
    await this.recordAttemptError(ctx, reason);
    await this.failStageExecution(ctx.stageExecutionId, reason, ctx.stageItemId);
  }

  // ---------------------------------------------------------------------
  // phase 7 chunk 4 — the per-item outer loop's own methods, called by
  // `stage-execute.fn.ts` (never by the per-item attempt loop itself).
  // ---------------------------------------------------------------------

  /** §14.3/§14's runtime item-count resolution: resolves `stage.iterate.over`
   * (no `itemIndex` in scope — this precedes any item's own attempt),
   * asserts the array-narrowing the validator already checked at save time
   * still holds, enforces `maxItems`, and — when this stage's `iterate.over`
   * canonicalizes to the same producer as an aligned previous iterating
   * stage — asserts the resolved count still matches that stage's own
   * `itemCount`. Returns a discriminated result rather than throwing for
   * every one of these conditions, so the caller can fail the stage
   * cleanly instead of leaving it to a retried/thrown step. */
  async resolveIterateCount(
    runId: string,
    stageExecutionId: string,
    stage: StageDef,
    effective: EffectiveStageConfig,
    prevStageKey: string | undefined,
  ): Promise<{ ok: true; itemCount: number } | { ok: false; reason: string }> {
    const iterate = stage.iterate;
    if (!iterate) {
      throw new Error(
        `StageRunnerService.resolveIterateCount: stage "${stage.key}" does not declare iterate`,
      );
    }
    const [inputs, assetBindings] = await Promise.all([
      this.loadRunInputs(runId),
      this.loadAssetBindings(runId),
    ]);
    const { value } = await this.bindingResolver.resolve(iterate.over, {
      runId,
      prevStageKey,
      inputs,
      assetBindings,
      stageKey: stage.key,
    });
    if (!Array.isArray(value)) {
      // Defensive — the validator already requires `iterate.over` to
      // narrow to an array schema at save time (Chunk 1).
      return { ok: false, reason: 'iterate_over_not_array' };
    }
    const itemCount = value.length;
    const maxItems = effective.iterate?.maxItems ?? this.engineConfig.iterateMaxItems;
    if (itemCount > maxItems) {
      return { ok: false, reason: 'iterate_max_items_exceeded' };
    }

    if (prevStageKey) {
      const graph = await this.loadGraph(runId);
      const stageIndex = graph.findIndex((s) => s.key === stage.key);
      const prevStage = stageIndex > 0 ? graph[stageIndex - 1] : undefined;
      if (
        prevStage?.iterate &&
        this.sameIterateProducer(iterate.over, prevStage.iterate.over, graph, stageIndex)
      ) {
        const [prevExecution] = await this.db
          .select({ itemCount: stageExecution.itemCount })
          .from(stageExecution)
          .where(and(eq(stageExecution.runId, runId), eq(stageExecution.stageKey, prevStageKey)))
          .limit(1);
        if (
          prevExecution?.itemCount !== undefined &&
          prevExecution.itemCount !== null &&
          itemCount !== prevExecution.itemCount
        ) {
          return { ok: false, reason: 'iterate_item_count_mismatch' };
        }
      }
    }

    return { ok: true, itemCount };
  }

  private async loadGraph(runId: string): Promise<StageDef[]> {
    const [row] = await this.db
      .select({ graph: blueprintVersion.graph })
      .from(run)
      .innerJoin(blueprintVersion, eq(run.blueprintVersionId, blueprintVersion.id))
      .where(eq(run.id, runId))
      .limit(1);
    if (!row) throw new Error(`StageRunnerService: run ${runId} not found`);
    return StageDef.array().parse(row.graph);
  }

  /** §14.3's canonicalization, applied at run time with the concrete graph
   * in hand (the validator's own version runs at save time over a
   * `ValidationContext`; this mirrors its semantics for `prev`/`memory`/
   * `input` refs without needing that context). Two refs canonicalize to
   * the same producer when they resolve to the same `(producerKey, path)`
   * pair — each ref is canonicalized relative to the stage that actually
   * declares it (`refA` at `stageIndexOfA`, `refB` at `stageIndexOfA - 1`,
   * i.e. the previous stage's own index). Any other ref kind (or a missing
   * preceding stage) is "not comparable" — never treated as aligned. */
  private sameIterateProducer(
    refA: Ref,
    refB: Ref,
    graph: StageDef[],
    stageIndexOfA: number,
  ): boolean {
    const a = this.canonicalizeIterateOver(refA, graph, stageIndexOfA);
    const b = this.canonicalizeIterateOver(refB, graph, stageIndexOfA - 1);
    if (!a || !b) return false;
    return a.producerKey === b.producerKey && a.path === b.path;
  }

  private canonicalizeIterateOver(
    ref: Ref,
    graph: StageDef[],
    stageIndex: number,
  ): { producerKey: string; path: string } | undefined {
    switch (ref.from) {
      case 'prev': {
        const prev = stageIndex > 0 ? graph[stageIndex - 1] : undefined;
        if (!prev) return undefined;
        return { producerKey: prev.key, path: ref.path ?? '$' };
      }
      case 'memory':
        return { producerKey: `memory:${ref.key}`, path: ref.path ?? '$' };
      case 'input':
        return { producerKey: `$input:${ref.inputKey}`, path: ref.path ?? '$' };
      default:
        return undefined;
    }
  }

  /** Bulk-creates `stage_item` rows 0..itemCount-1 as `'pending'`
   * (`ON CONFLICT DO NOTHING` — idempotent against a replayed step) and
   * marks the stage_execution as iterating. Called once per stage
   * execution, before the outer loop invokes any item.
   *
   * MEDIUM finding #2 (PR #17 review) — a self-consistency guard against
   * re-entering with a DIFFERENT `itemCount` than a prior call recorded.
   * This can legitimately happen once the HIGH-finding fix lands: retrying
   * an iterating stage's own `iterate.over` source (§15.2) invalidates
   * every one of this stage's items at once, and if the array's resolved
   * length also changed, the next `resolveIterateCount`/`ensureStageItems`
   * pass would otherwise silently overwrite `itemCount` and leave stale or
   * mismatched trailing `stage_item` rows with no guard. The invariant:
   * an `itemCount` change is only safe when every existing `stage_item` row
   * has already been marked `'stale'` by `InvalidationService.apply()` —
   * anything else means a count changed WITHOUT going through invalidation
   * first, which this method refuses rather than corrupting the rows.
   * Deliberately does not delete/reconcile trailing rows on a shrink —
   * `stage_attempt.stage_item_id` has no cascade, so deleting a `stage_item`
   * with real attempts would either violate that FK or silently destroy
   * spend/audit history; `ON CONFLICT DO NOTHING` leaving them in place is
   * the safe choice. */
  async ensureStageItems(stageExecutionId: string, itemCount: number): Promise<void> {
    const [execution] = await this.db
      .select({ itemCount: stageExecution.itemCount })
      .from(stageExecution)
      .where(eq(stageExecution.id, stageExecutionId))
      .limit(1);
    if (!execution) {
      throw new Error(
        `StageRunnerService.ensureStageItems: stage execution ${stageExecutionId} not found`,
      );
    }
    if (execution.itemCount !== null && execution.itemCount !== itemCount) {
      const existingItems = await this.db
        .select({ itemIndex: stageItem.itemIndex, state: stageItem.state })
        .from(stageItem)
        .where(eq(stageItem.stageExecutionId, stageExecutionId));
      const notStale = existingItems.find((item) => item.state !== 'stale');
      if (notStale) {
        throw new Error(
          `StageRunnerService.ensureStageItems: stage execution ${stageExecutionId} item count ` +
            `changed from ${execution.itemCount} to ${itemCount}, but item ${notStale.itemIndex} ` +
            `is '${notStale.state}' (expected 'stale') — an item count change must go through ` +
            `InvalidationService.apply() first`,
        );
      }
    }

    await this.db
      .update(stageExecution)
      .set({ isIterating: true, itemCount })
      .where(eq(stageExecution.id, stageExecutionId));
    if (itemCount === 0) return;
    await this.db
      .insert(stageItem)
      .values(
        Array.from({ length: itemCount }, (_, itemIndex) => ({
          id: ulid(),
          stageExecutionId,
          itemIndex,
          state: 'pending' as const,
        })),
      )
      .onConflictDoNothing();
  }

  /** §14.5's partial resume, expressed the same way `run.orchestrate`
   * already skips a passed `stage_execution`: a cheap read the outer loop
   * uses to decide whether to `step.invoke` this item at all. */
  async itemState(
    stageExecutionId: string,
    itemIndex: number,
  ): Promise<{ id: string; state: string }> {
    const [row] = await this.db
      .select({ id: stageItem.id, state: stageItem.state })
      .from(stageItem)
      .where(
        and(eq(stageItem.stageExecutionId, stageExecutionId), eq(stageItem.itemIndex, itemIndex)),
      )
      .limit(1);
    if (!row) {
      throw new Error(
        `StageRunnerService: stage_item not found for execution ${stageExecutionId} index ${itemIndex}`,
      );
    }
    return row;
  }

  /** §12.4 manual pause — the per-item outer loop in `stage.execute` checks
   * this before invoking each item, mirroring `run.orchestrate`'s own
   * between-stage check, so a paused run stops after the current item
   * instead of running an iterating stage to completion. Unlocked read (no
   * `for('update')`): this is a runnability check, not a mutation
   * precondition. */
  async getRunState(runId: string) {
    const [row] = await this.db.select({ state: run.state }).from(run).where(eq(run.id, runId));
    return row?.state;
  }

  /** Locked Decision 6 — once every item has passed, the stage_execution
   * itself turns 'passed' and its `outputArtifactId` becomes a convenience
   * pointer at the LAST item's artifact (not a sanctioned read path —
   * Run Memory and `{from:'prev', alignWith:'item'}` are). */
  async finishIteratingStage(stageExecutionId: string): Promise<{ artifactId: string }> {
    const [execution] = await this.db
      .select({ itemCount: stageExecution.itemCount })
      .from(stageExecution)
      .where(eq(stageExecution.id, stageExecutionId))
      .limit(1);
    if (!execution || execution.itemCount === null || execution.itemCount === undefined) {
      throw new Error(
        `StageRunnerService.finishIteratingStage: stage execution ${stageExecutionId} has no itemCount`,
      );
    }
    if (execution.itemCount === 0) {
      throw new Error(
        `StageRunnerService.finishIteratingStage: stage execution ${stageExecutionId} has zero items`,
      );
    }
    const [lastItem] = await this.db
      .select({ outputArtifactId: stageItem.outputArtifactId })
      .from(stageItem)
      .where(
        and(
          eq(stageItem.stageExecutionId, stageExecutionId),
          eq(stageItem.itemIndex, execution.itemCount - 1),
        ),
      )
      .limit(1);
    if (!lastItem?.outputArtifactId) {
      throw new Error(
        `StageRunnerService.finishIteratingStage: last item of ${stageExecutionId} has no outputArtifactId`,
      );
    }
    await this.db
      .update(stageExecution)
      .set({
        state: 'passed',
        endedAt: new Date().toISOString(),
        outputArtifactId: lastItem.outputArtifactId,
      })
      .where(eq(stageExecution.id, stageExecutionId));
    return { artifactId: lastItem.outputArtifactId };
  }
}
