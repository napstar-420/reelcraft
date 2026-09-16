import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { JobHandle, JobStatus } from '@reefcraft/shared';
import { StageDef } from '@reefcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { run, blueprintVersion, stageAttempt, stageExecution, channel } from '../db/schema/index';
import { ulid } from '../common/ulid';
import { fromUsd } from '../common/money';
import { renderPrompt } from '../common/prompt-template';
import { CapabilityRegistry } from '../capability/capability.registry';
import {
  BindingResolverService,
  type ResolvedBindings,
} from '../artifact/binding-resolver.service';
import { ArtifactService } from '../artifact/artifact.service';
import { BlobService } from '../artifact/blob.service';
import { MemoryService } from '../artifact/memory.service';
import { LedgerService } from '../budget/ledger.service';
import {
  ConfigResolverService,
  type EffectiveStageConfig,
} from '../run-config/config-resolver.service';
import { SchemaValidatorService } from '../json-schema/schema-validator.service';

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

/**
 * §3/§7.2/§13 — the engine loop for one stage attempt: resolve inputs,
 * submit, poll, fetch, run finalization. Split into small methods so the
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
    private readonly memory: MemoryService,
    private readonly ledger: LedgerService,
    private readonly configResolver: ConfigResolverService,
    private readonly schemaValidator: SchemaValidatorService,
  ) {}

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

  async beginAttempt(ctx: {
    runId: string;
    stageExecutionId: string;
    stageKey: string;
    attemptNo: number;
  }): Promise<StageAttemptContext> {
    const stageAttemptId = ulid();
    await this.db.insert(stageAttempt).values({
      id: stageAttemptId,
      stageExecutionId: ctx.stageExecutionId,
      attemptNo: ctx.attemptNo,
      outcome: 'success', // provisional; overwritten in finalizeSuccess/recordFailure
      resolvedInputs: {},
      phase: 'created',
      actor: 'engine',
    });
    return { ...ctx, stageAttemptId };
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

  private async resolveBindings(
    stage: StageDef,
    runId: string,
    prevStageKey: string | undefined,
  ): Promise<ResolvedBindings> {
    const inputs = await this.loadRunInputs(runId);
    return this.bindingResolver.resolveAll(stage, { runId, prevStageKey, inputs });
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

  async reserveAndSubmit(
    stage: StageDef,
    ctx: StageAttemptContext,
    prevStageKey: string | undefined,
    effective: EffectiveStageConfig,
  ): Promise<JobHandle> {
    const capability = this.capabilities.get(stage.capability);
    const bindings = await this.resolveBindings(stage, ctx.runId, prevStageKey);
    const templateScope = { ...bindings.slots, ...bindings.context };
    const renderedPrompt = stage.instructions?.template
      ? renderPrompt(stage.instructions.template, templateScope)
      : undefined;
    const execCtx = this.buildExecCtx(ctx, effective, bindings, renderedPrompt);

    const handle = await capability.submit(execCtx);

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

    return handle;
  }

  async pollOnce(stage: StageDef, handle: JobHandle): Promise<JobStatus> {
    const capability = this.capabilities.get(stage.capability);
    return capability.poll(handle);
  }

  async fetchAndFinalize(
    stage: StageDef,
    ctx: StageAttemptContext,
    handle: JobHandle,
    prevStageKey: string | undefined,
    effective: EffectiveStageConfig,
  ): Promise<{ artifactId: string }> {
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

    const kind = stage.output.kind === 'data' ? 'data' : 'text';
    const data = kind === 'text' ? { text: result.output } : result.output;
    const artifactId = await this.artifacts.recordAttemptArtifact({
      runId: ctx.runId,
      producerStageKey: stage.key,
      kind,
      data,
      ...(stage.output.kind === 'data' && {
        schemaHash: this.schemaValidator.hashOf(stage.output.schema),
      }),
      reproLevel: result.repro.level,
      repro: result.repro,
      costUsd: result.costUsd,
    });

    await this.artifacts.finalize({
      runId: ctx.runId,
      stageExecutionId: ctx.stageExecutionId,
      producerStageKey: stage.key,
      newArtifactId: artifactId,
      applyWrites: this.memory.buildWriteCallback(stage, {
        runId: ctx.runId,
        stageKey: stage.key,
        kind,
        data,
      }),
    });

    await this.ledger.recordActual({
      runId: ctx.runId,
      stageKey: stage.key,
      stageAttemptId: ctx.stageAttemptId,
      category: 'stage_output',
      amountUsd: result.costUsd,
    });

    await this.db
      .update(stageAttempt)
      .set({
        outcome: 'success',
        phase: 'settled',
        artifactId,
        rawResponseRef,
        costUsd: fromUsd(result.costUsd),
      })
      .where(eq(stageAttempt.id, ctx.stageAttemptId));

    await this.db
      .update(stageExecution)
      .set({ state: 'passed', endedAt: new Date().toISOString() })
      .where(eq(stageExecution.id, ctx.stageExecutionId));

    return { artifactId };
  }

  async recordFailure(ctx: StageAttemptContext, reason: string): Promise<void> {
    await this.db
      .update(stageAttempt)
      .set({ outcome: 'provider_error', phase: 'settled', reviewNote: reason })
      .where(eq(stageAttempt.id, ctx.stageAttemptId));
    await this.db
      .update(stageExecution)
      .set({ state: 'failed', failure: { reason }, endedAt: new Date().toISOString() })
      .where(eq(stageExecution.id, ctx.stageExecutionId));
  }
}
