import { createHash } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Ref, StageDef } from '@reefcraft/shared';
import { StageDef as StageDefSchema } from '@reefcraft/shared';
import { MemoryService } from '../artifact/memory.service';
import type { RefProvenance } from '../artifact/binding-resolver.service';
import { DRIZZLE, type Db, type Tx } from '../db/drizzle.provider';
import {
  artifact,
  blob,
  blueprintVersion,
  ledgerEntry,
  run,
  runMemory,
  stageAttempt,
  stageExecution,
  stageItem,
} from '../db/schema/index';
import { canonicalJson } from '../json-schema/schema-hash';
import {
  computeInvalidationClosure,
  type ActiveExecutionRead,
  type InvalidationClosure,
  type InvalidationSeed,
} from './invalidation-closure';

export interface InvalidationCost {
  artifactId: string;
  stageKey: string;
  /** phase 7 chunk 5 — set when the cost row belongs to one item of an
   * iterating stage rather than the stage as a whole. */
  itemIndex?: number;
  spentUsd: number;
  estimatedRerunUsd: number;
}

export interface InvalidationPreview {
  closure: InvalidationClosure;
  costs: InvalidationCost[];
  totals: { spentUsd: number; estimatedRerunUsd: number };
  fingerprint: string;
}

/** phase 7 chunk 5 — true iff `stage`'s OWN declared bindings (any slot,
 * context, or script-check ref) include a `{from:'prevItem'}` anywhere.
 * Deliberately computed from the `StageDef`, not from any attempt's
 * recorded `resolved_inputs`: an item-0 attempt never actually resolves a
 * value for `prevItem` (no artifactId is ever recorded for it), so
 * provenance-only inference would silently under-invalidate item 0's
 * dependents whenever item 0 is the only item that has run so far. */
function stageBindsPrevItem(stage: StageDef): boolean {
  const isPrevItem = (ref: Ref): boolean => ref.from === 'prevItem';
  if (Object.values(stage.slots).some(isPrevItem)) return true;
  if (Object.values(stage.context).some(isPrevItem)) return true;
  for (const check of stage.checks) {
    if (check.type === 'script' && check.refs && Object.values(check.refs).some(isPrevItem)) {
      return true;
    }
  }
  return false;
}

type StageAttemptRow = typeof stageAttempt.$inferSelect;
type StageItemRow = typeof stageItem.$inferSelect;

/** Loads the observed dependency graph recorded on attempts and applies the
 * resulting closure. All state-changing methods accept the caller's locked
 * transaction so they can be composed with revision/outbox mutations. */
@Injectable()
export class InvalidationService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly memory: MemoryService,
  ) {}

  async preview(params: { runId: string; seed: InvalidationSeed }): Promise<InvalidationPreview> {
    const [runRow] = await this.db
      .select({ graph: blueprintVersion.graph })
      .from(run)
      .innerJoin(blueprintVersion, eq(run.blueprintVersionId, blueprintVersion.id))
      .where(eq(run.id, params.runId))
      .limit(1);
    if (!runRow) throw new NotFoundException(`Run ${params.runId} not found`);

    const graph = StageDefSchema.array().parse(runRow.graph);
    const graphOrder = graph.map((stage) => stage.key);
    const stageByKey = new Map(graph.map((stage) => [stage.key, stage]));

    const executions = await this.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.runId, params.runId));
    const executionIds = executions.map((row) => row.id);
    const [attempts, items] = await Promise.all([
      executionIds.length === 0
        ? Promise.resolve<StageAttemptRow[]>([])
        : this.db
            .select()
            .from(stageAttempt)
            .where(inArray(stageAttempt.stageExecutionId, executionIds)),
      executionIds.length === 0
        ? Promise.resolve<StageItemRow[]>([])
        : this.db.select().from(stageItem).where(inArray(stageItem.stageExecutionId, executionIds)),
    ]);

    const itemsByExecution = new Map<string, StageItemRow[]>();
    for (const item of items) {
      const list = itemsByExecution.get(item.stageExecutionId);
      if (list) list.push(item);
      else itemsByExecution.set(item.stageExecutionId, [item]);
    }

    const nonItemAttempts = attempts.filter((attempt) => attempt.stageItemId === null);
    const itemAttempts = attempts.filter((attempt) => attempt.stageItemId !== null);

    const activeAttemptByExecution = new Map<string, StageAttemptRow>();
    for (const execution of executions) {
      const candidates = nonItemAttempts.filter(
        (attempt) => attempt.stageExecutionId === execution.id,
      );
      const active = execution.outputArtifactId
        ? candidates.find((attempt) => attempt.artifactId === execution.outputArtifactId)
        : undefined;
      const latest = candidates.reduce<StageAttemptRow | undefined>(
        (current, attempt) =>
          !current || attempt.attemptNo > current.attemptNo ? attempt : current,
        undefined,
      );
      if (active ?? latest) activeAttemptByExecution.set(execution.id, (active ?? latest)!);
    }

    const activeAttemptByItem = new Map<string, StageAttemptRow>();
    for (const item of items) {
      const candidates = itemAttempts.filter((attempt) => attempt.stageItemId === item.id);
      const active = item.outputArtifactId
        ? candidates.find((attempt) => attempt.artifactId === item.outputArtifactId)
        : undefined;
      const latest = candidates.reduce<StageAttemptRow | undefined>(
        (current, attempt) =>
          !current || attempt.attemptNo > current.attemptNo ? attempt : current,
        undefined,
      );
      if (active ?? latest) activeAttemptByItem.set(item.id, (active ?? latest)!);
    }

    // phase 7 chunk 5 — one node per item for an iterating stage (that has
    // any `stage_item` rows at all), otherwise the single stage-level node
    // exactly as before phase 7.
    const activeExecutionReads: ActiveExecutionRead[] = [];
    for (const execution of executions) {
      const stageItemsForExecution = (itemsByExecution.get(execution.id) ?? [])
        .slice()
        .sort((a, b) => a.itemIndex - b.itemIndex);
      if (stageItemsForExecution.length > 0) {
        const stage = stageByKey.get(execution.stageKey);
        const bindsPrevItem = stage ? stageBindsPrevItem(stage) : false;
        for (const item of stageItemsForExecution) {
          const attempt = activeAttemptByItem.get(item.id);
          activeExecutionReads.push({
            stageKey: execution.stageKey,
            stageExecutionId: execution.id,
            itemIndex: item.itemIndex,
            ...(item.outputArtifactId ? { artifactId: item.outputArtifactId } : {}),
            bindsPrevItem,
            provenance: (attempt?.resolvedInputs ?? {}) as Record<string, RefProvenance>,
          });
        }
      } else {
        activeExecutionReads.push({
          stageKey: execution.stageKey,
          stageExecutionId: execution.id,
          ...(execution.outputArtifactId ? { artifactId: execution.outputArtifactId } : {}),
          provenance: (activeAttemptByExecution.get(execution.id)?.resolvedInputs ?? {}) as Record<
            string,
            RefProvenance
          >,
        });
      }
    }

    const memoryRows = await this.db
      .select()
      .from(runMemory)
      .where(eq(runMemory.runId, params.runId));
    const inputArtifacts = await this.db
      .select({ id: artifact.id, producerStageKey: artifact.producerStageKey })
      .from(artifact)
      .where(and(eq(artifact.runId, params.runId), eq(artifact.stale, false)));
    const seededInputArtifactIds = inputArtifacts
      .filter((row) =>
        (params.seed.inputKeys ?? []).includes(row.producerStageKey.replace(/^\$input:/, '')),
      )
      .map((row) => row.id);

    const closure = computeInvalidationClosure({
      graphOrder,
      executions: activeExecutionReads,
      seed: {
        ...params.seed,
        artifactIds: [...(params.seed.artifactIds ?? []), ...seededInputArtifactIds],
      },
      memoryVersionWriters: memoryRows.map((row) => ({
        memoryKey: row.memKey,
        memoryVersion: row.version,
        stageKey: row.writtenBy,
        ...(row.writtenItem === null ? {} : { itemIndex: row.writtenItem }),
      })),
    });

    const affectedAttempts = attempts.filter((attempt) =>
      closure.affectedExecutionIds.includes(attempt.stageExecutionId),
    );
    const activeAttemptByArtifact = new Map(
      affectedAttempts
        .filter((attempt) => attempt.artifactId !== null)
        .map((attempt) => [attempt.artifactId!, attempt]),
    );
    const affectedArtifacts =
      closure.affectedArtifactIds.length === 0
        ? []
        : await this.db
            .select()
            .from(artifact)
            .where(inArray(artifact.id, closure.affectedArtifactIds));
    const attemptIds = affectedAttempts.map((attempt) => attempt.id);
    const reservations =
      attemptIds.length === 0
        ? []
        : await this.db
            .select()
            .from(ledgerEntry)
            .where(
              and(
                inArray(ledgerEntry.stageAttemptId, attemptIds),
                eq(ledgerEntry.kind, 'reservation'),
              ),
            );
    const reservedByAttempt = new Map<string, number>();
    for (const entry of reservations) {
      if (!entry.stageAttemptId) continue;
      reservedByAttempt.set(
        entry.stageAttemptId,
        (reservedByAttempt.get(entry.stageAttemptId) ?? 0) + Number(entry.amountUsd),
      );
    }

    // phase 7 chunk 5 — one cost row per invalid ITEM (not per stage): an
    // iterating stage's affected items each spent and may re-spend their
    // own money, so summing per stage would misreport a partially
    // invalidated iterating stage's true exposure.
    const costs: InvalidationCost[] = closure.affectedItems.flatMap((item) => {
      if (!item.artifactId) return [];
      const row = affectedArtifacts.find((candidate) => candidate.id === item.artifactId);
      if (!row) return [];
      const attempt = activeAttemptByArtifact.get(row.id);
      return [
        {
          artifactId: row.id,
          stageKey: item.stageKey,
          ...(item.itemIndex !== undefined ? { itemIndex: item.itemIndex } : {}),
          spentUsd: Number(row.costUsd),
          estimatedRerunUsd: attempt ? (reservedByAttempt.get(attempt.id) ?? 0) : 0,
        },
      ];
    });
    const totals = costs.reduce(
      (sum, cost) => ({
        spentUsd: sum.spentUsd + cost.spentUsd,
        estimatedRerunUsd: sum.estimatedRerunUsd + cost.estimatedRerunUsd,
      }),
      { spentUsd: 0, estimatedRerunUsd: 0 },
    );
    const fingerprint = createHash('sha256')
      .update(canonicalJson({ runId: params.runId, seed: params.seed, closure, costs, totals }))
      .digest('hex');
    return { closure, costs, totals, fingerprint };
  }

  async apply(
    tx: Tx,
    params: { runId: string; closure: InvalidationClosure; targetStageKey: string },
  ): Promise<void> {
    if (params.closure.affectedArtifactIds.length > 0) {
      const affected = await tx
        .select({ id: artifact.id, blobId: artifact.blobId })
        .from(artifact)
        .where(inArray(artifact.id, params.closure.affectedArtifactIds));
      await tx
        .update(artifact)
        .set({ stale: true })
        .where(inArray(artifact.id, params.closure.affectedArtifactIds));

      const blobIds = affected.map((row) => row.blobId).filter((id): id is string => id !== null);
      if (blobIds.length > 0) {
        await tx
          .update(blob)
          .set({ gcEligible: true, gcEligibleAt: new Date().toISOString() })
          .where(and(inArray(blob.id, blobIds), eq(blob.scope, 'run')));
      }
    }

    // phase 7 chunk 5 — item-scoped stale marking: a stage with SOME but
    // not all items invalid must not have its `stage_execution.state` set
    // to 'stale' (that would incorrectly imply every item needs rerunning,
    // discarding sibling items' completed work) — only the specific
    // invalid `stage_item` rows are staled, and the outer per-item loop in
    // `stage.execute` (Chunk 4) re-checks each item's own state on every
    // invocation regardless of the stage_execution's own state.
    if (params.closure.affectedExecutionIds.length > 0) {
      const itemsByExecution = new Map<string, number[]>();
      for (const item of params.closure.affectedItems) {
        if (item.itemIndex === undefined) continue;
        const list = itemsByExecution.get(item.stageExecutionId);
        if (list) list.push(item.itemIndex);
        else itemsByExecution.set(item.stageExecutionId, [item.itemIndex]);
      }

      const executionRows = await tx
        .select({
          id: stageExecution.id,
          stageKey: stageExecution.stageKey,
          isIterating: stageExecution.isIterating,
          itemCount: stageExecution.itemCount,
        })
        .from(stageExecution)
        .where(inArray(stageExecution.id, params.closure.affectedExecutionIds));

      for (const row of executionRows) {
        const invalidItemIndexes = itemsByExecution.get(row.id) ?? [];
        const isWholeStageInvalid =
          !row.isIterating ||
          invalidItemIndexes.length === 0 ||
          (row.itemCount !== null && invalidItemIndexes.length >= row.itemCount);

        if (isWholeStageInvalid) {
          await tx
            .update(stageExecution)
            .set({
              state: 'stale',
              outputArtifactId: null,
              failure: null,
              endedAt: null,
              ...(row.stageKey === params.targetStageKey
                ? { generation: sql`${stageExecution.generation} + 1` }
                : {}),
            })
            .where(eq(stageExecution.id, row.id));
          if (row.isIterating) {
            await tx
              .update(stageItem)
              .set({ state: 'stale', outputArtifactId: null, failure: null })
              .where(eq(stageItem.stageExecutionId, row.id));
          }
        } else {
          await tx
            .update(stageItem)
            .set({ state: 'stale', outputArtifactId: null, failure: null })
            .where(
              and(
                eq(stageItem.stageExecutionId, row.id),
                inArray(stageItem.itemIndex, invalidItemIndexes),
              ),
            );
          // The stage_execution row itself is left exactly as it is
          // (typically 'passed') — some items remain valid — but the
          // target stage's generation still ticks for UI labelling
          // (§15.3), matching the whole-stage branch's own bump.
          if (row.stageKey === params.targetStageKey) {
            await tx
              .update(stageExecution)
              .set({ generation: sql`${stageExecution.generation} + 1` })
              .where(eq(stageExecution.id, row.id));
          }
        }
      }
    }

    await this.memory.appendTombstones(
      tx,
      params.runId,
      params.closure.affectedItems.map((item) => ({
        stageKey: item.stageKey,
        ...(item.itemIndex !== undefined ? { itemIndex: item.itemIndex } : {}),
      })),
    );
    await tx
      .update(run)
      .set({ cursorStageKey: params.targetStageKey })
      .where(eq(run.id, params.runId));
  }

  async listMemory(runId: string) {
    const [currentRows, history] = await Promise.all([
      this.memory.listCurrent(this.db, runId),
      this.memory.listHistory(this.db, runId),
    ]);
    return {
      current: Object.fromEntries(currentRows.map((row) => [row.memKey, row])),
      history,
    };
  }
}
