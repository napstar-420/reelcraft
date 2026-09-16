import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { JobHandle, JobStatus, StageDef } from '@reefcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { run, blueprintVersion, stageAttempt, stageExecution, channel } from '../db/schema/index';
import { ulid } from '../common/ulid';
import { fromUsd } from '../common/money';
import { CapabilityRegistry } from '../capability/capability.registry';
import { BindingResolverService } from '../artifact/binding-resolver.service';
import { ArtifactService } from '../artifact/artifact.service';
import { BlobService } from '../artifact/blob.service';
import { MemoryService } from '../artifact/memory.service';
import { LedgerService } from '../budget/ledger.service';

export interface StageAttemptContext {
  runId: string;
  stageExecutionId: string;
  stageKey: string;
  attemptNo: number;
  stageAttemptId: string;
}

/**
 * §3/§7.2/§13 — the engine loop for one stage attempt: resolve inputs,
 * submit, poll, fetch, run finalization. Split into small methods so the
 * Inngest function (functions/stage-execute.fn.ts) can place a step
 * boundary around each provider call (§13.3) — steps return IDs, never
 * payloads (§13.2 Rule 1).
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
  ) {}

  async loadStageDef(runId: string, stageKey: string): Promise<StageDef> {
    const [row] = await this.db
      .select({ graph: blueprintVersion.graph })
      .from(run)
      .innerJoin(blueprintVersion, eq(run.blueprintVersionId, blueprintVersion.id))
      .where(eq(run.id, runId))
      .limit(1);
    if (!row) throw new Error(`StageRunnerService: run ${runId} not found`);
    const graph = row.graph as StageDef[];
    const stage = graph.find((s) => s.key === stageKey);
    if (!stage)
      throw new Error(`StageRunnerService: stage "${stageKey}" not in run ${runId}'s graph`);
    return stage;
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

  async reserveAndSubmit(
    stage: StageDef,
    ctx: StageAttemptContext,
    inputs: Record<string, unknown>,
  ): Promise<JobHandle> {
    const capability = this.capabilities.get(stage.capability);
    const renderedPrompt = stage.instructions?.template
      ? renderTemplate(stage.instructions.template, inputs)
      : undefined;
    const idempotencyKey = this.idempotencyKey(ctx);

    const handle = await capability.submit({
      runId: ctx.runId,
      stageKey: ctx.stageKey,
      attemptNo: ctx.attemptNo,
      config: stage.model ?? {},
      slots: {},
      context: {},
      renderedPrompt,
      idempotencyKey,
      logger: { log: () => {}, error: () => {} },
    });

    await this.db
      .update(stageAttempt)
      .set({
        phase: 'submitted',
        idempotencyKey,
        renderedPrompt,
        jobHandle: handle,
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
  ): Promise<{ artifactId: string }> {
    const capability = this.capabilities.get(stage.capability);
    const result = await capability.fetch(handle, {
      runId: ctx.runId,
      stageKey: ctx.stageKey,
      attemptNo: ctx.attemptNo,
      config: stage.model ?? {},
      slots: {},
      context: {},
      idempotencyKey: this.idempotencyKey(ctx),
      logger: { log: () => {}, error: () => {} },
    });

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
    const artifactId = await this.artifacts.recordAttemptArtifact({
      runId: ctx.runId,
      producerStageKey: stage.key,
      kind,
      data: kind === 'text' ? { text: result.output } : result.output,
      reproLevel: result.repro.level,
      repro: result.repro,
      costUsd: result.costUsd,
    });

    await this.artifacts.finalize({
      runId: ctx.runId,
      stageExecutionId: ctx.stageExecutionId,
      producerStageKey: stage.key,
      newArtifactId: artifactId,
    });

    await this.memory.applyWrites(stage.key, undefined, artifactId);

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

/** §6.5 — restricted `{{ name }}` / `{{ name.field }}` path grammar. Phase 1
 * has no context bindings yet, so this is intentionally minimal; the full
 * validator-checked templating engine is phase 2. */
function renderTemplate(template: string, values: Record<string, unknown>): string {
  return template.replace(/{{\s*([\w.[\]]+)\s*}}/g, (_match, path: string) => {
    const value = path.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object' && key in acc)
        return (acc as Record<string, unknown>)[key];
      return undefined;
    }, values);
    return value === undefined ? '' : String(value);
  });
}
