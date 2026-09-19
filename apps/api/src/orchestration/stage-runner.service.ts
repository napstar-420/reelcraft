import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { JobHandle, JobStatus, QcDef } from '@reefcraft/shared';
import { StageDef } from '@reefcraft/shared';
import { CONSUMES_SEMANTIC_ATTEMPT } from './attempt-outcome';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { run, blueprintVersion, stageAttempt, stageExecution, channel } from '../db/schema/index';
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

export interface StageAttemptContext {
  runId: string;
  stageExecutionId: string;
  stageKey: string;
  attemptNo: number;
  stageAttemptId: string;
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
  ) {}

  /** Parks an orchestrator-only human.input stage without creating an
   * engine attempt, reservation, or provider job. */
  async awaitHumanInput(runId: string, stageExecutionId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(stageExecution)
        .set({ state: 'awaiting_input', startedAt: new Date().toISOString() })
        .where(eq(stageExecution.id, stageExecutionId));
      await this.humanWaits.open(tx, { runId, stageExecutionId, kind: 'input' });
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
  }): Promise<StageAttemptContext> {
    const [row] = await this.db
      .select({ maxAttempt: sql<number>`coalesce(max(${stageAttempt.attemptNo}), 0)` })
      .from(stageAttempt)
      .where(
        and(
          eq(stageAttempt.stageExecutionId, ctx.stageExecutionId),
          isNull(stageAttempt.stageItemId),
        ),
      );
    const attemptNo = (row?.maxAttempt ?? 0) + 1;
    const stageAttemptId = ulid();

    try {
      await this.db.insert(stageAttempt).values({
        id: stageAttemptId,
        stageExecutionId: ctx.stageExecutionId,
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
            isNull(stageAttempt.stageItemId),
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
  async countSemanticAttemptsUsed(stageExecutionId: string): Promise<number> {
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
          isNull(stageAttempt.stageItemId),
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

  private async resolveBindings(
    stage: StageDef,
    runId: string,
    prevStageKey: string | undefined,
  ): Promise<ResolvedBindings> {
    const [inputs, assetBindings] = await Promise.all([
      this.loadRunInputs(runId),
      this.loadAssetBindings(runId),
    ]);
    return this.bindingResolver.resolveAll(stage, { runId, prevStageKey, inputs, assetBindings });
  }

  /** §3.8.1's critique log — derived from prior `stage_attempt` rows'
   * existing `checkResults`/`qcVerdict` columns, no new table/column. Human
   * rejection notes (`reviewNote`, §10.5) are deliberately left out here — a
   * future `rejected`-outcome branch slots in without restructuring this. */
  async loadCritiqueLog(stageExecutionId: string, beforeAttemptNo: number): Promise<string> {
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
          isNull(stageAttempt.stageItemId),
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
  ) {
    return {
      runId: ctx.runId,
      stageKey: ctx.stageKey,
      attemptNo: ctx.attemptNo,
      // §7.2 TODO: this should be a ProviderClient scoped to the effective
      // model pin, not raw config on ctx.config — carried over from phase 1
      // as a deliberate shortcut; changing it is a capability-contract
      // change, out of phase-2 scope.
      config: { ...effective.capabilityConfig, ...effective.model },
      slots: bindings.slots,
      context: bindings.context,
      renderedPrompt,
      idempotencyKey: this.idempotencyKey(ctx),
      logger: { log: () => {}, error: () => {} },
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
    const bindings = await this.resolveBindings(stage, ctx.runId, prevStageKey);
    const priorCritique = await this.loadCritiqueLog(ctx.stageExecutionId, ctx.attemptNo);
    const templateScope = { ...bindings.slots, ...bindings.context, priorCritique };
    const renderedPrompt = stage.instructions?.template
      ? renderPrompt(stage.instructions.template, templateScope)
      : undefined;
    const execCtx = this.buildExecCtx(ctx, effective, bindings, renderedPrompt);

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
        renderedPrompt,
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

  async fetchAndFinalize(
    stage: StageDef,
    ctx: StageAttemptContext,
    handle: JobHandle,
    prevStageKey: string | undefined,
    effective: EffectiveStageConfig,
  ): Promise<FetchAndFinalizeResult> {
    const capability = this.capabilities.get(stage.capability);
    const bindings = await this.resolveBindings(stage, ctx.runId, prevStageKey);
    const execCtx = this.buildExecCtx(ctx, effective, bindings);
    const result = await capability.fetch(handle, execCtx);

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
      ? (result.output as import('@reefcraft/shared').MediaSource)
      : undefined;
    const persistedMedia = mediaOutput
      ? await this.mediaArtifacts.persist({
          ownerId: channelRow?.ownerId ?? 'local', channelId: runRow.channelId, runId: ctx.runId, source: mediaOutput,
        })
      : undefined;
    const kind = stage.output.kind === 'data' ? 'data' : stage.output.kind === 'text' ? 'text' : stage.output.kind;
    const data = kind === 'text' ? { text: result.output } : kind === 'data' ? result.output : undefined;
    const artifactId = await this.artifacts.recordAttemptArtifact({
      runId: ctx.runId,
      producerStageKey: stage.key,
      kind,
      data,
      ...(persistedMedia && { blobId: persistedMedia.blobId, probe: persistedMedia.probe }),
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

    const checkArtifact: CheckArtifact = { kind, data, ...(persistedMedia && { probe: persistedMedia.probe }) };
    const resolvedRefs: Array<Record<string, RefEnvelope>> = [];
    const checkProvenance: ResolvedBindings['provenance'] = {};
    for (const [checkIndex, check] of stage.checks.entries()) {
      if (check.type === 'script' && check.refs) {
        const resolved = await this.bindingResolver.resolveRefEnvelopes(check.refs, {
          runId: ctx.runId,
          prevStageKey,
          inputs: await this.loadRunInputs(ctx.runId),
          assetBindings: await this.loadAssetBindings(ctx.runId),
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
    // Video is audio-bearing by default. A stage must explicitly request
    // `forbidden` or `optional` to accept a silent provider result.
    if (stage.output.kind === 'media.video' && persistedMedia) {
      const audioPolicy = stage.output.constraints?.audio ?? 'required';
      const hasAudio = persistedMedia.probe.streams.some((stream) => stream.type === 'audio');
      if ((audioPolicy === 'required' && !hasAudio) || (audioPolicy === 'forbidden' && hasAudio)) {
        checkResults.push({ name: 'audio_constraint', kind: 'builtin', pass: false, fault: 'artifact', message: `video audio is ${hasAudio ? 'present' : 'absent'} but output requires ${audioPolicy}` });
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
        if (stage.approval.mode !== 'stage') {
          throw new Error('Item approval is not available until iteration support');
        }
        await tx
          .update(stageAttempt)
          .set({ outcome: 'awaiting_approval', phase: 'awaiting_approval', checkResults })
          .where(eq(stageAttempt.id, ctx.stageAttemptId));
        await tx
          .update(stageExecution)
          .set({ state: 'awaiting_approval' })
          .where(eq(stageExecution.id, ctx.stageExecutionId));
        await this.humanWaits.open(tx, {
          runId: ctx.runId,
          stageExecutionId: ctx.stageExecutionId,
          kind: 'approval',
        });
        return { outcome: 'approval_required' as const, artifactId };
      }

      await this.artifacts.finalize(
        {
          runId: ctx.runId,
          stageExecutionId: ctx.stageExecutionId,
          producerStageKey: stage.key,
          newArtifactId: artifactId,
          applyWrites: this.memory.buildWriteCallback(stage, {
            runId: ctx.runId,
            stageKey: stage.key,
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

      await tx
        .update(stageExecution)
        .set({ state: 'passed', endedAt: new Date().toISOString() })
        .where(eq(stageExecution.id, ctx.stageExecutionId));

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
  async failStageExecution(stageExecutionId: string, reason: string): Promise<void> {
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
    await this.failStageExecution(ctx.stageExecutionId, reason);
  }
}
