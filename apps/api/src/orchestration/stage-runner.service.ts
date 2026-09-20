import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { JobHandle, JobStatus, QcDef, Ref } from '@reefcraft/shared';
import { StageDef } from '@reefcraft/shared';
import { CONSUMES_SEMANTIC_ATTEMPT } from './attempt-outcome';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import {
  run,
  blueprintVersion,
  stageAttempt,
  stageExecution,
  stageItem,
  channel,
} from '../db/schema/index';
import { ulid } from '../common/ulid';
import { fromUsd } from '../common/money';
import { renderPrompt } from '../common/prompt-template';
import { CapabilityRegistry } from '../capability/capability.registry';
import {
  BindingResolverService,
  type RefEnvelope,
  type ResolvedBindings,
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
import { buildQcEnvelope } from '../qc/qc-envelope';
import { HumanWaitService } from '../run/human-wait.service';
import { TimelineCheckService } from '../check/timeline-check.service';
import { TimelineHandleService } from '../artifact/timeline-handle.service';
import { TimelineResourceResolverService } from '../artifact/timeline-resource-resolver.service';
import { FileArtifactService } from '../artifact/file-artifact.service';

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
   * query (`beginAttempt`'s own predicate, `countSemanticAttemptsUsed`,
   * `countInfraAttemptsUsed`, `loadCritiqueLog`, `failStageExecution` via
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
 * without a thrown exception. `check_failed`/`qc_failed` are semantic
 * (consume a retry, §3.8.1); `qc_error` is terminal regardless of remaining
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
  | { outcome: 'qc_budget_exhausted'; checkResults: CheckResult[] };

/** §11 — `reserveAndSubmit`'s outcome: either a reservation was made and
 * the job submitted, or the reserve step itself rejected the attempt
 * before any provider was ever contacted (§11.4's `created` phase — the
 * attempt row never advances to `reserved`/`submitting`). */
export type SubmitOutcome =
  | { outcome: 'submitted'; handle: JobHandle }
  | { outcome: 'budget_blocked'; reason: 'run_cap_exceeded' | 'stage_cap_exceeded' }
  | { outcome: 'run_not_running' };

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
    kind: 'input' | 'timeline_edit' = 'input',
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
      return { ...ctx, attemptNo, stageAttemptId };
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

  /** §3.8.1/§11 — replaces a raw `attemptNo` comparison as the source of
   * "semantic attempts used so far". `budget_blocked` breaks the old
   * invariant that `attemptNo` itself equals that count (every prior
   * looping outcome was in `CONSUMES_SEMANTIC_ATTEMPT`; `budget_blocked`
   * must also loop, after a resume, without consuming a retry). Called
   * BEFORE the current attempt runs, so it reflects attempts used prior to
   * this one — the same semantics `stage-execute.fn.ts`'s prior
   * `attemptNo >= retryLimit + 1` check had for every outcome that isn't
   * `budget_blocked`. */
  async countSemanticAttemptsUsed(stageExecutionId: string, stageItemId?: string): Promise<number> {
    const scopePredicate = stageItemId
      ? eq(stageAttempt.stageItemId, stageItemId)
      : isNull(stageAttempt.stageItemId);
    const [execution] = await this.db
      .select({ runId: stageExecution.runId, stageKey: stageExecution.stageKey })
      .from(stageExecution)
      .where(eq(stageExecution.id, stageExecutionId))
      .limit(1);
    if (!execution) throw new Error(`Stage execution ${stageExecutionId} not found`);
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(stageAttempt)
      .where(
        and(
          eq(stageAttempt.stageExecutionId, stageExecutionId),
          scopePredicate,
          inArray(stageAttempt.outcome, [...CONSUMES_SEMANTIC_ATTEMPT]),
        ),
      );
    const [routed] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(stageAttempt)
      .innerJoin(stageExecution, eq(stageAttempt.stageExecutionId, stageExecution.id))
      .where(
        and(
          eq(stageExecution.runId, execution.runId),
          eq(stageAttempt.outcome, 'rejected'),
          eq(stageAttempt.critiqueTargetStageKey, execution.stageKey),
        ),
      );
    return (row?.count ?? 0) + (routed?.count ?? 0);
  }

  async countInfraAttemptsUsed(stageExecutionId: string, stageItemId?: string): Promise<number> {
    const scopePredicate = stageItemId
      ? eq(stageAttempt.stageItemId, stageItemId)
      : isNull(stageAttempt.stageItemId);
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(stageAttempt)
      .where(
        and(
          eq(stageAttempt.stageExecutionId, stageExecutionId),
          scopePredicate,
          eq(stageAttempt.outcome, 'infra_error'),
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

  private async loadRoleBindings(runId: string): Promise<
    Record<
      string,
      {
        characterId: string;
        name: string;
        description: string;
        references: Array<{ blobId: string; sourceKey: string; mime: string; probe?: unknown }>;
      }
    >
  > {
    const [row] = await this.db
      .select({ roleBindings: run.roleBindings })
      .from(run)
      .where(eq(run.id, runId))
      .limit(1);
    if (!row) throw new Error(`StageRunnerService: run ${runId} not found`);
    return row.roleBindings as Record<
      string,
      {
        characterId: string;
        name: string;
        description: string;
        references: Array<{ blobId: string; sourceKey: string; mime: string; probe?: unknown }>;
      }
    >;
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
        const summary = results
          .filter((r) => !r.pass)
          .map((r) => r.message ?? r.name)
          .join('; ');
        lines.push(`Attempt ${row.attemptNo} failed: ${summary}`);
      } else if (row.outcome === 'qc_failed') {
        const verdict = row.qcVerdict as QcVerdict | null;
        lines.push(`Attempt ${row.attemptNo} failed QC: ${verdict?.critique ?? ''}`);
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
      lines.push(`Human rejection: ${rejection.reviewNote ?? 'No note provided'}`);
    }
    return lines.join('\n');
  }

  private buildExecCtx(
    ctx: StageAttemptContext,
    effective: EffectiveStageConfig,
    bindings: ResolvedBindings,
    renderedPrompt?: string,
    resources?: Awaited<ReturnType<TimelineResourceResolverService['resolve']>>,
  ) {
    return {
      runId: ctx.runId,
      stageKey: ctx.stageKey,
      attemptNo: ctx.attemptNo,
      itemIndex: ctx.itemIndex,
      // §7.2 TODO: this should be a ProviderClient scoped to the effective
      // model pin, not raw config on ctx.config — carried over from phase 1
      // as a deliberate shortcut; changing it is a capability-contract
      // change, out of phase-2 scope.
      config: { ...effective.capabilityConfig, ...effective.model },
      slots: bindings.slots,
      context: bindings.context,
      renderedPrompt,
      idempotencyKey: this.idempotencyKey(ctx, ctx.itemIndex),
      logger: { log: () => {}, error: () => {} },
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
    const templateScope = { ...bindings.slots, ...bindings.context, priorCritique };
    const renderedPrompt = stage.instructions?.template
      ? renderPrompt(stage.instructions.template, templateScope)
      : undefined;
    const resources =
      stage.capability === 'timeline.render' && bindings.slots.timeline
        ? await this.timelineResources.resolve(ctx.runId, bindings.slots.timeline)
        : undefined;
    const unpreparedExecCtx = this.buildExecCtx(
      ctx,
      effective,
      bindings,
      renderedPrompt,
      resources,
    );
    const execCtx = capability.prepare?.(unpreparedExecCtx) ?? unpreparedExecCtx;

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
      if (reserved.reason === 'run_not_running') return { outcome: 'run_not_running' };
      return { outcome: 'budget_blocked', reason: reserved.reason };
    }

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

    return { outcome: 'submitted', handle };
  }

  async pollOnce(stage: StageDef, handle: JobHandle): Promise<JobStatus> {
    const capability = this.capabilities.get(stage.capability);
    return capability.poll(handle);
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

  async recordInfraError(ctx: StageAttemptContext, reason: string): Promise<void> {
    await this.db
      .update(stageAttempt)
      .set({ outcome: 'infra_error', phase: 'settled', reviewNote: reason })
      .where(eq(stageAttempt.id, ctx.stageAttemptId));
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
    const execCtx = this.buildExecCtx(ctx, effective, bindings, undefined, resources);
    const result = await capability.fetch(handle, execCtx);
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

    const mediaOutput = stage.output.kind.startsWith('media.')
      ? (output as import('@reefcraft/shared').MediaSource)
      : undefined;
    const fileOutput =
      stage.output.kind === 'file.subtitles'
        ? (output as import('@reefcraft/shared').FileSource)
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
    const data =
      kind === 'text'
        ? { text: output }
        : kind === 'data' || kind === 'timeline'
          ? output
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

    if (!checkResults.every((r) => r.pass)) {
      await this.db
        .update(stageAttempt)
        .set({ outcome: 'check_failed', checkResults })
        .where(eq(stageAttempt.id, ctx.stageAttemptId));
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
          return { outcome: 'qc_budget_exhausted', checkResults };
        }
      }

      const qcOutcome = await this.runQcWithRetries(
        stage.qc,
        effective.qc,
        ctx,
        checkArtifact,
        bindings,
      );

      if (qcOutcome.status === 'error') {
        await this.db
          .update(stageAttempt)
          .set({ outcome: 'qc_error', checkResults, reviewNote: qcOutcome.reason })
          .where(eq(stageAttempt.id, ctx.stageAttemptId));
        return { outcome: 'qc_error', reason: qcOutcome.reason };
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
        return { outcome: 'qc_failed', checkResults, qcVerdict: qcOutcome.verdict };
      }

      await this.db
        .update(stageAttempt)
        .set({ qcVerdict: qcOutcome.verdict })
        .where(eq(stageAttempt.id, ctx.stageAttemptId));
    }

    return this.db.transaction(async (tx) => {
      const [lockedRun] = await tx
        .select({ state: run.state })
        .from(run)
        .where(eq(run.id, ctx.runId))
        .for('update');
      if (!lockedRun || lockedRun.state !== 'RUNNING') {
        await tx
          .update(stageAttempt)
          .set({ outcome: 'cancelled', phase: 'settled', checkResults })
          .where(eq(stageAttempt.id, ctx.stageAttemptId));
        return { outcome: 'run_not_running' as const };
      }

      if (stage.approval) {
        await tx
          .update(stageAttempt)
          .set({ outcome: 'awaiting_approval', phase: 'awaiting_approval', checkResults })
          .where(eq(stageAttempt.id, ctx.stageAttemptId));

        if (stage.approval.mode === 'stage') {
          await tx
            .update(stageExecution)
            .set({ state: 'awaiting_approval' })
            .where(eq(stageExecution.id, ctx.stageExecutionId));
          await this.humanWaits.open(tx, {
            runId: ctx.runId,
            stageExecutionId: ctx.stageExecutionId,
            kind: 'approval',
          });
        } else {
          // phase 7 chunk 6 — item-mode approval: the pause is scoped to
          // this ONE item. `stage_execution` is deliberately left alone
          // (still 'running') — the outer per-item loop only flips it to
          // 'passed' once every item has, via `finishIteratingStage`
          // (Locked Decision 5/6), so it must not read `awaiting_approval`
          // while sibling items may still be pending or already passed.
          // `stage.execute.item`'s caller always runs this attempt with an
          // item-scoped `stageItemId` (the blueprint validator already
          // requires `approval.mode:'item'` to imply `stage.iterate`), so
          // this is a defensive assertion, not a real branch in practice.
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
          costUsd: result.costUsd,
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
