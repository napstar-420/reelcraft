import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { StageDef, Timeline } from '@reefcraft/shared';
import { ArtifactService } from '../artifact/artifact.service';
import { BindingResolverService, type RefProvenance } from '../artifact/binding-resolver.service';
import { MemoryService } from '../artifact/memory.service';
import { CheckRunner } from '../check/check-runner.service';
import type { CheckArtifact, CheckResult } from '../check/check.types';
import { ulid } from '../common/ulid';
import { toUsd } from '../common/money';
import { DRIZZLE, type Db, type Tx } from '../db/drizzle.provider';
import {
  artifact,
  blueprintVersion,
  humanWait,
  run,
  stageAttempt,
  stageExecution,
  stageItem,
} from '../db/schema/index';
import { SchemaValidatorService } from '../json-schema/schema-validator.service';
import { ConfigResolverService } from '../run-config/config-resolver.service';
import { CONSUMES_SEMANTIC_ATTEMPT } from '../orchestration/attempt-outcome';
import { InvalidationService } from './invalidation.service';
import type { InvalidationSeed } from './invalidation-closure';
import { HumanWaitService } from './human-wait.service';
import { PreviewTokenService } from './preview-token.service';
import { RunMutationService } from './run-mutation.service';
import { RunWakeupDispatcher } from './run-wakeup-dispatcher.service';
import { TimelineCheckService } from '../check/timeline-check.service';

@Injectable()
export class HumanActionService {
  private readonly logger = new Logger(HumanActionService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly mutation: RunMutationService,
    private readonly dispatcher: RunWakeupDispatcher,
    private readonly artifacts: ArtifactService,
    private readonly memory: MemoryService,
    private readonly waits: HumanWaitService,
    private readonly bindingResolver: BindingResolverService,
    private readonly checks: CheckRunner,
    private readonly schemaValidator: SchemaValidatorService,
    private readonly invalidation: InvalidationService,
    private readonly tokens: PreviewTokenService,
    private readonly configResolver: ConfigResolverService,
    private readonly timelineChecks: TimelineCheckService,
  ) {}

  async approve(runId: string, stageKey: string, itemIndex?: number) {
    const result = await this.mutation.withLockedRun(
      runId,
      'approve',
      ['PAUSED_APPROVAL'],
      (tx, lockedRun) => this.approveInTransaction(tx, runId, stageKey, lockedRun, itemIndex),
      'run/resumed',
    );
    await this.dispatchBestEffort(result.wakeupId);
    return { accepted: true, revision: result.revision };
  }

  async approveInTransaction(
    tx: Tx,
    runId: string,
    stageKey: string,
    lockedRun: typeof run.$inferSelect,
    itemIndex?: number,
  ): Promise<void> {
    if (lockedRun.cursorStageKey !== stageKey) {
      throw new ConflictException(
        `Approval is waiting at ${lockedRun.cursorStageKey ?? 'no stage'}`,
      );
    }
    const { stage, execution } = await this.loadStageAndExecution(tx, lockedRun, stageKey);

    if (stage.approval?.mode === 'item') {
      const item = await this.resolveOpenItem(tx, execution.id, itemIndex);
      await this.approveItemInTransaction(tx, runId, stageKey, stage, execution.id, item);
      return;
    }

    const pending = await this.pendingAttempt(tx, execution.id);
    if (!pending?.artifactId || pending.phase !== 'awaiting_approval') {
      throw new ConflictException('No pending approval candidate exists');
    }
    const [candidate] = await tx
      .select()
      .from(artifact)
      .where(eq(artifact.id, pending.artifactId))
      .limit(1);
    if (!candidate || !candidate.stale) throw new ConflictException('Approval candidate is stale');
    await this.requireOpenWait(tx, execution.id, 'approval');

    await this.artifacts.finalize(
      {
        runId,
        stageExecutionId: execution.id,
        producerStageKey: stageKey,
        newArtifactId: candidate.id,
        applyWrites: this.memory.buildWriteCallback(stage, {
          runId,
          stageKey,
          kind: candidate.kind as never,
          data: candidate.data,
        }),
      },
      tx,
    );
    await tx
      .update(stageAttempt)
      .set({ outcome: 'success', phase: 'settled' })
      .where(eq(stageAttempt.id, pending.id));
    await tx
      .update(stageExecution)
      .set({ state: 'passed', endedAt: new Date().toISOString() })
      .where(eq(stageExecution.id, execution.id));
    await this.waits.resolve(tx, execution.id);
  }

  /** phase 7 chunk 6 — the item-mode analogue of `approveInTransaction`'s
   * stage-mode body above: same shape (finalize, settle the attempt,
   * resolve the wait), but scoped to one `stage_item` and deliberately
   * NOT touching `stage_execution` — Locked Decision 5/6, mirroring
   * `StageRunnerService.fetchAndFinalize`'s own item finalize branch. */
  private async approveItemInTransaction(
    tx: Tx,
    runId: string,
    stageKey: string,
    stage: StageDef,
    stageExecutionId: string,
    item: typeof stageItem.$inferSelect,
  ): Promise<void> {
    const pending = await this.pendingAttempt(tx, stageExecutionId, item.id);
    if (!pending?.artifactId || pending.phase !== 'awaiting_approval') {
      throw new ConflictException('No pending approval candidate exists');
    }
    const [candidate] = await tx
      .select()
      .from(artifact)
      .where(eq(artifact.id, pending.artifactId))
      .limit(1);
    if (!candidate || !candidate.stale) throw new ConflictException('Approval candidate is stale');
    await this.requireOpenWait(tx, stageExecutionId, 'approval', item.id);

    await this.artifacts.finalize(
      {
        runId,
        stageExecutionId,
        producerStageKey: stageKey,
        itemIndex: item.itemIndex,
        stageItemId: item.id,
        newArtifactId: candidate.id,
        costUsd: toUsd(pending.costUsd),
        applyWrites: this.memory.buildWriteCallback(stage, {
          runId,
          stageKey,
          itemIndex: item.itemIndex,
          kind: candidate.kind as never,
          data: candidate.data,
        }),
      },
      tx,
    );
    await tx
      .update(stageAttempt)
      .set({ outcome: 'success', phase: 'settled' })
      .where(eq(stageAttempt.id, pending.id));
    await this.waits.resolve(tx, stageExecutionId);
  }

  /** phase 7 chunk 6 — resolves "the item currently awaiting approval" for
   * an item-mode stage's execution. Iteration is strictly sequential, so at
   * most one `stage_item` is ever `awaiting_approval` per execution at a
   * time; a caller-supplied `itemIndex` is a race-safety confirmation
   * against that open item, not something trusted blindly. */
  private async resolveOpenItem(
    executor: Db | Tx,
    stageExecutionId: string,
    itemIndex: number | undefined,
  ): Promise<typeof stageItem.$inferSelect> {
    const [openItem] = await executor
      .select()
      .from(stageItem)
      .where(
        and(
          eq(stageItem.stageExecutionId, stageExecutionId),
          eq(stageItem.state, 'awaiting_approval'),
        ),
      )
      .limit(1);
    if (!openItem) throw new ConflictException('No item is awaiting approval for this stage');
    if (itemIndex !== undefined && openItem.itemIndex !== itemIndex) {
      throw new ConflictException(
        `Item ${itemIndex} is not the one awaiting approval (currently item ${openItem.itemIndex})`,
      );
    }
    return openItem;
  }

  async reject(
    runId: string,
    stageKey: string,
    note: string | undefined,
    previewToken?: string,
    itemIndex?: number,
  ) {
    const context = await this.loadRunContext(runId, stageKey);
    const isItemMode = context.stage.approval?.mode === 'item';
    // phase 7 chunk 6 — Locked Decision 9: a rejected item, with no
    // `onReject.retryStageKey`, retries that same item by default — the
    // item-mode analogue of stage-mode's existing "retry myself" default.
    // Resolved from the DB (the item currently `awaiting_approval`), not
    // trusted blindly from the caller — `itemIndex`, when given, is only a
    // race-safety confirmation against that open item.
    const rejectedItem = isItemMode
      ? await this.resolveOpenItem(this.db, context.execution.id, itemIndex)
      : undefined;
    const resolvedItemIndex = rejectedItem?.itemIndex;

    const targetStageKey = context.stage.approval?.onReject?.retryStageKey ?? stageKey;
    const targetStage = context.graph.find((stage) => stage.key === targetStageKey);
    if (!targetStage) throw new ConflictException(`Retry target ${targetStageKey} not found`);
    const [targetExecution] = await this.db
      .select()
      .from(stageExecution)
      .where(and(eq(stageExecution.runId, runId), eq(stageExecution.stageKey, targetStageKey)))
      .limit(1);
    if (!targetExecution) throw new ConflictException(`Retry target ${targetStageKey} not found`);
    const effective = await this.configResolver.effectiveStageConfig(
      runId,
      targetStageKey,
      targetStage,
    );

    // Item-scoping only applies when the rejected stage is itself item-mode
    // AND the retry target also iterates — a routed rejection into a
    // non-iterating earlier stage (or one that doesn't iterate) stays
    // whole-stage, matching the plan's explicit resolution for this case.
    const targetItemIndex =
      resolvedItemIndex !== undefined && targetStage.iterate ? resolvedItemIndex : undefined;
    const targetStageItem =
      targetItemIndex !== undefined
        ? (
            await this.db
              .select()
              .from(stageItem)
              .where(
                and(
                  eq(stageItem.stageExecutionId, targetExecution.id),
                  eq(stageItem.itemIndex, targetItemIndex),
                ),
              )
              .limit(1)
          )[0]
        : undefined;
    if (targetItemIndex !== undefined && !targetStageItem) {
      throw new ConflictException(
        `Retry target item ${targetItemIndex} of ${targetStageKey} not found`,
      );
    }

    const retryDebits = await this.retryDebits(
      runId,
      targetExecution.id,
      targetStageKey,
      targetStageItem?.id,
    );
    // phase 7 chunk 6 — an iterating target's own itemRetryLimit gates
    // exhaustion, not the stage's (non-iterating) retryLimit.
    const exhausted = targetStage.iterate
      ? retryDebits + 1 >= effective.iterate!.itemRetryLimit + 1
      : retryDebits + 1 >= effective.retryLimit + 1;
    const payload = {
      stageKey,
      ...(note !== undefined ? { note } : {}),
      ...(resolvedItemIndex !== undefined ? { itemIndex: resolvedItemIndex } : {}),
    };

    const seed: InvalidationSeed = !isItemMode
      ? { stageKeys: [targetStageKey], forcedStageKeys: [stageKey] }
      : (() => {
          const items: Array<{ stageKey: string; itemIndex: number }> = [];
          const stageKeys: string[] = [];
          if (targetItemIndex !== undefined) {
            items.push({ stageKey: targetStageKey, itemIndex: targetItemIndex });
          } else {
            stageKeys.push(targetStageKey);
          }
          // Always force the rejected item itself invalid, regardless of
          // whether the retry target's dependency chain structurally
          // reaches it — the item-mode analogue of stage-mode's
          // `forcedStageKeys:[stageKey]` above. `markInvalid` dedupes by
          // key, so this is a no-op when it's the same node as above.
          items.push({ stageKey, itemIndex: resolvedItemIndex! });
          return {
            ...(items.length > 0 ? { items } : {}),
            ...(stageKeys.length > 0 ? { stageKeys } : {}),
          };
        })();

    const preview = await this.invalidation.preview({ runId, seed });
    if (!previewToken) {
      const issued = this.tokens.issue({
        action: 'reject',
        runId,
        runRevision: context.run.revision,
        proposedPayload: payload,
        preview: { fingerprint: preview.fingerprint, targetStageKey },
      });
      return {
        previewToken: issued.token,
        expiresAt: issued.expiresAt,
        targetStageKey,
        affectedStageKeys: preview.closure.affectedStageKeys,
        spentUsd: preview.totals.spentUsd,
        estimatedRerunUsd: preview.totals.estimatedRerunUsd,
      };
    }

    const claims = this.tokens.verify<{ fingerprint: string; targetStageKey: string }>(
      previewToken,
      {
        action: 'reject',
        runId,
        runRevision: context.run.revision,
        proposedPayload: payload,
      },
    );
    if (claims.preview.fingerprint !== preview.fingerprint) {
      throw new ConflictException('The rejection preview changed; request a new preview');
    }
    const result = await this.mutation.withLockedRun(
      runId,
      'reject',
      ['PAUSED_APPROVAL'],
      async (tx, lockedRun) => {
        if (lockedRun.revision !== claims.runRevision || lockedRun.cursorStageKey !== stageKey) {
          throw new ConflictException('The approval changed; request a new preview');
        }
        const { execution } = await this.loadStageAndExecution(tx, lockedRun, stageKey);
        const pendingItem = isItemMode
          ? await this.resolveOpenItem(tx, execution.id, resolvedItemIndex)
          : undefined;
        const pending = await this.pendingAttempt(tx, execution.id, pendingItem?.id);
        if (!pending) throw new ConflictException('No pending approval candidate exists');
        await tx
          .update(stageAttempt)
          .set({
            outcome: 'rejected',
            reviewNote: note ?? null,
            critiqueTargetStageKey: targetStageKey,
          })
          .where(eq(stageAttempt.id, pending.id));
        await this.waits.resolve(tx, execution.id);
        await this.invalidation.apply(tx, {
          runId,
          closure: preview.closure,
          targetStageKey,
        });
        if (exhausted) {
          if (targetStageItem) {
            // phase 7 chunk 6 — item-mode exhaustion fails only the
            // target's own item, mirroring §14.1's "no continue-and-isolate":
            // the item still fails the run (below), but sibling items of
            // the same iterating stage are left completely alone.
            await tx
              .update(stageItem)
              .set({
                state: 'failed',
                failure: { reason: 'approval_rejection_retry_exhausted' },
              })
              .where(eq(stageItem.id, targetStageItem.id));
          } else {
            await tx
              .update(stageExecution)
              .set({
                state: 'failed',
                failure: { reason: 'approval_rejection_retry_exhausted' },
                endedAt: new Date().toISOString(),
              })
              .where(eq(stageExecution.id, targetExecution.id));
          }
          await tx
            .update(run)
            .set({
              state: 'FAILED',
              cursorStageKey: targetStageKey,
              endedAt: new Date().toISOString(),
            })
            .where(eq(run.id, runId));
        }
      },
      exhausted ? 'run/rejection-exhausted' : 'run/resumed',
    );
    await this.dispatchBestEffort(result.wakeupId);
    return { accepted: true, revision: result.revision, state: exhausted ? 'FAILED' : 'PENDING' };
  }

  async submitInput(
    runId: string,
    stageKey: string,
    value: unknown,
    expectedDraftRevision?: number,
  ) {
    const context = await this.loadRunContext(runId, stageKey);
    if (context.run.state !== 'PAUSED_INPUT' || context.run.cursorStageKey !== stageKey) {
      throw new ConflictException('The run is not waiting for input at this stage');
    }
    if (
      context.stage.capability !== 'human.input' &&
      context.stage.capability !== 'human.timeline_edit'
    ) {
      throw new ConflictException('The cursor stage is not a human input capability');
    }
    const candidateData = this.validateHumanValue(context.stage, value);
    const evaluated = await this.evaluateHumanChecks(
      context.run,
      context.graph,
      context.stage,
      candidateData,
    );

    if (!evaluated.checkResults.every((result) => result.pass)) {
      await this.persistFailedHumanSubmission(
        context.run,
        context.stage,
        context.execution.id,
        candidateData,
        evaluated,
      );
      throw new UnprocessableEntityException({
        code: 'human_input_check_failed',
        checkResults: evaluated.checkResults,
      });
    }

    const result = await this.mutation.withLockedRun(
      runId,
      'submit_input',
      ['PAUSED_INPUT'],
      async (tx, lockedRun) => {
        if (lockedRun.revision !== context.run.revision || lockedRun.cursorStageKey !== stageKey) {
          throw new ConflictException('The input wait changed; submit again');
        }
        if (expectedDraftRevision !== undefined) {
          const [wait] = await tx
            .select({ draftRevision: humanWait.draftRevision })
            .from(humanWait)
            .where(
              and(
                eq(humanWait.stageExecutionId, context.execution.id),
                eq(humanWait.kind, 'timeline_edit'),
                isNull(humanWait.resolvedAt),
              ),
            )
            .limit(1);
          if (!wait || wait.draftRevision !== expectedDraftRevision) {
            throw new ConflictException({
              code: 'timeline_draft_conflict',
              draftRevision: wait?.draftRevision,
            });
          }
        }
        await this.persistPassingHumanSubmission(
          tx,
          lockedRun,
          context.stage,
          context.execution.id,
          candidateData,
          evaluated,
        );
      },
      'run/resumed',
    );
    await this.dispatchBestEffort(result.wakeupId);
    return { accepted: true, revision: result.revision };
  }

  private async persistPassingHumanSubmission(
    tx: Tx,
    lockedRun: typeof run.$inferSelect,
    stage: StageDef,
    executionId: string,
    data: unknown,
    evaluated: { provenance: Record<string, RefProvenance>; checkResults: CheckResult[] },
  ) {
    await this.requireOpenWait(
      tx,
      executionId,
      stage.capability === 'human.timeline_edit' ? 'timeline_edit' : 'input',
    );
    const attemptNo = await this.nextAttemptNo(tx, executionId);
    const artifactId = await this.artifacts.recordAttemptArtifact(
      {
        runId: lockedRun.id,
        producerStageKey: stage.key,
        kind: stage.output.kind,
        data,
        ...(stage.output.kind === 'data'
          ? { schemaHash: this.schemaValidator.hashOf(stage.output.schema) }
          : {}),
        reproLevel: 'exact',
        costUsd: 0,
      },
      tx,
    );
    await tx.insert(stageAttempt).values({
      id: ulid(),
      stageExecutionId: executionId,
      attemptNo,
      outcome: 'success',
      phase: 'settled',
      actor: 'user',
      resolvedInputs: evaluated.provenance,
      checkResults: evaluated.checkResults,
      artifactId,
    });
    await this.artifacts.finalize(
      {
        runId: lockedRun.id,
        stageExecutionId: executionId,
        producerStageKey: stage.key,
        newArtifactId: artifactId,
        applyWrites: this.memory.buildWriteCallback(stage, {
          runId: lockedRun.id,
          stageKey: stage.key,
          kind: stage.output.kind,
          data,
        }),
      },
      tx,
    );
    await tx
      .update(stageExecution)
      .set({ state: 'passed', endedAt: new Date().toISOString() })
      .where(eq(stageExecution.id, executionId));
    await this.waits.resolve(tx, executionId);
  }

  private async persistFailedHumanSubmission(
    runRow: typeof run.$inferSelect,
    stage: StageDef,
    executionId: string,
    data: unknown,
    evaluated: { provenance: Record<string, RefProvenance>; checkResults: CheckResult[] },
  ) {
    await this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(run).where(eq(run.id, runRow.id)).for('update');
      if (
        !locked ||
        locked.revision !== runRow.revision ||
        locked.state !== 'PAUSED_INPUT' ||
        locked.cursorStageKey !== stage.key
      ) {
        throw new ConflictException('The input wait changed; submit again');
      }
      await this.requireOpenWait(
        tx,
        executionId,
        stage.capability === 'human.timeline_edit' ? 'timeline_edit' : 'input',
      );
      const attemptNo = await this.nextAttemptNo(tx, executionId);
      const artifactId = await this.artifacts.recordAttemptArtifact(
        {
          runId: runRow.id,
          producerStageKey: stage.key,
          kind: stage.output.kind,
          data,
          ...(stage.output.kind === 'data'
            ? { schemaHash: this.schemaValidator.hashOf(stage.output.schema) }
            : {}),
          reproLevel: 'exact',
          costUsd: 0,
        },
        tx,
      );
      await tx.insert(stageAttempt).values({
        id: ulid(),
        stageExecutionId: executionId,
        attemptNo,
        outcome: 'check_failed',
        phase: 'settled',
        actor: 'user',
        resolvedInputs: evaluated.provenance,
        checkResults: evaluated.checkResults,
        artifactId,
      });
    });
  }

  private async evaluateHumanChecks(
    runRow: typeof run.$inferSelect,
    graph: StageDef[],
    stage: StageDef,
    data: unknown,
  ) {
    const index = graph.findIndex((candidate) => candidate.key === stage.key);
    const prevStageKey = index > 0 ? graph[index - 1]?.key : undefined;
    const resolvedRefs: Record<string, never>[] = [];
    const provenance: Record<string, RefProvenance> = {};
    for (const [checkIndex, check] of stage.checks.entries()) {
      if (check.type === 'script' && check.refs) {
        const resolved = await this.bindingResolver.resolveRefEnvelopes(check.refs, {
          runId: runRow.id,
          prevStageKey,
          inputs: runRow.inputs as Record<string, unknown>,
          assetBindings: runRow.assetBindings as Record<string, { blobId: string; kind: string }>,
        });
        resolvedRefs.push(resolved.refs as Record<string, never>);
        for (const [name, source] of Object.entries(resolved.provenance)) {
          provenance[`checks.${checkIndex}.refs.${name}`] = source;
        }
      } else {
        resolvedRefs.push({});
      }
    }
    const checkResults = await this.checks.run({
      checks: stage.checks,
      artifact: { kind: stage.output.kind, data } as CheckArtifact,
      resolvedRefs,
      ...(stage.output.kind === 'data' ? { outputSchema: stage.output.schema } : {}),
    });
    if (stage.output.kind === 'timeline') {
      const effective = await this.configResolver.effectiveStageConfig(runRow.id, stage.key, stage);
      const config = effective.capabilityConfig as {
        allowGaps?: boolean;
        toleranceSec?: number;
      };
      checkResults.unshift(
        ...(await this.timelineChecks.run({
          runId: runRow.id,
          timeline: data,
          allowGaps: config.allowGaps,
          toleranceSec: config.toleranceSec,
          aspectRatio: effective.layer.format?.aspectRatio,
        })),
      );
    }
    return { provenance, checkResults };
  }

  private validateHumanValue(stage: StageDef, value: unknown): unknown {
    if (stage.output.kind === 'text') {
      if (typeof value !== 'string') {
        throw new UnprocessableEntityException('human.input text output requires a string');
      }
      return { text: value };
    }
    if (stage.output.kind === 'data') {
      const violations = this.schemaValidator.validate(stage.output.schema, value);
      if (violations.length > 0) {
        throw new UnprocessableEntityException({ code: 'schema_invalid', violations });
      }
      return value;
    }
    if (stage.output.kind === 'timeline') {
      const parsed = Timeline.safeParse(value);
      if (!parsed.success) {
        throw new UnprocessableEntityException({
          code: 'timeline_invalid',
          violations: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        });
      }
      return parsed.data;
    }
    throw new UnprocessableEntityException('Media human input is not available until Phase 5');
  }

  private async loadRunContext(runId: string, stageKey: string) {
    const [row] = await this.db
      .select({ run, graph: blueprintVersion.graph })
      .from(run)
      .innerJoin(blueprintVersion, eq(run.blueprintVersionId, blueprintVersion.id))
      .where(eq(run.id, runId))
      .limit(1);
    if (!row) throw new ConflictException(`Run ${runId} not found`);
    const graph = StageDef.array().parse(row.graph);
    const stage = graph.find((candidate) => candidate.key === stageKey);
    if (!stage) throw new ConflictException(`Stage ${stageKey} not found`);
    const [execution] = await this.db
      .select()
      .from(stageExecution)
      .where(and(eq(stageExecution.runId, runId), eq(stageExecution.stageKey, stageKey)))
      .limit(1);
    if (!execution) throw new ConflictException(`Execution ${stageKey} not found`);
    return { run: row.run, graph, stage, execution };
  }

  private async loadStageAndExecution(
    tx: Tx,
    lockedRun: typeof run.$inferSelect,
    stageKey: string,
  ) {
    const [version] = await tx
      .select({ graph: blueprintVersion.graph })
      .from(blueprintVersion)
      .where(eq(blueprintVersion.id, lockedRun.blueprintVersionId))
      .limit(1);
    const stage = version
      ? StageDef.array()
          .parse(version.graph)
          .find((candidate) => candidate.key === stageKey)
      : undefined;
    if (!stage) throw new ConflictException(`Stage ${stageKey} not found`);
    const [execution] = await tx
      .select()
      .from(stageExecution)
      .where(and(eq(stageExecution.runId, lockedRun.id), eq(stageExecution.stageKey, stageKey)))
      .limit(1);
    if (!execution) throw new ConflictException(`Execution ${stageKey} not found`);
    return { stage, execution };
  }

  /** phase 7 chunk 6 — `stageItemId` scopes the lookup to one item's own
   * attempts instead of the stage-level (`stageItemId IS NULL`) ones. */
  private async pendingAttempt(tx: Tx, executionId: string, stageItemId?: string) {
    const [row] = await tx
      .select()
      .from(stageAttempt)
      .where(
        and(
          eq(stageAttempt.stageExecutionId, executionId),
          stageItemId
            ? eq(stageAttempt.stageItemId, stageItemId)
            : isNull(stageAttempt.stageItemId),
        ),
      )
      .orderBy(desc(stageAttempt.attemptNo))
      .limit(1);
    return row;
  }

  private async requireOpenWait(
    tx: Tx,
    executionId: string,
    kind: 'approval' | 'input' | 'timeline_edit',
    stageItemId?: string,
  ) {
    const [wait] = await tx
      .select({ id: humanWait.id })
      .from(humanWait)
      .where(
        and(
          eq(humanWait.stageExecutionId, executionId),
          eq(humanWait.kind, kind),
          isNull(humanWait.resolvedAt),
          stageItemId ? eq(humanWait.stageItemId, stageItemId) : isNull(humanWait.stageItemId),
        ),
      )
      .limit(1);
    if (!wait) throw new ConflictException(`No open ${kind} wait exists`);
  }

  private async nextAttemptNo(tx: Tx, executionId: string): Promise<number> {
    const [row] = await tx
      .select({ max: sql<number>`coalesce(max(${stageAttempt.attemptNo}), 0)::int` })
      .from(stageAttempt)
      .where(eq(stageAttempt.stageExecutionId, executionId));
    return (row?.max ?? 0) + 1;
  }

  /** phase 7 chunk 6 — `stageItemId` scopes the "own" count to one item's
   * attempts. The "routed" (cross-stage critique) count deliberately stays
   * stage-wide regardless: `critiqueTargetStageKey` names a stage, not an
   * item — there is no item dimension anywhere else in the schema for a
   * routed rejection to carry, so introducing one here would be inventing
   * semantics nothing else in the phase has. */
  private async retryDebits(
    runId: string,
    executionId: string,
    stageKey: string,
    stageItemId?: string,
  ) {
    const [own] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(stageAttempt)
      .where(
        and(
          eq(stageAttempt.stageExecutionId, executionId),
          stageItemId
            ? eq(stageAttempt.stageItemId, stageItemId)
            : isNull(stageAttempt.stageItemId),
          inArray(stageAttempt.outcome, [...CONSUMES_SEMANTIC_ATTEMPT]),
        ),
      );
    const [routed] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(stageAttempt)
      .innerJoin(stageExecution, eq(stageAttempt.stageExecutionId, stageExecution.id))
      .where(
        and(
          eq(stageExecution.runId, runId),
          eq(stageAttempt.outcome, 'rejected'),
          eq(stageAttempt.critiqueTargetStageKey, stageKey),
        ),
      );
    return (own?.count ?? 0) + (routed?.count ?? 0);
  }

  private async dispatchBestEffort(wakeupId: string) {
    try {
      await this.dispatcher.dispatch(wakeupId);
    } catch (error) {
      this.logger.warn(
        `Run wakeup ${wakeupId} will be retried: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
