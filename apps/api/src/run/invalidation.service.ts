import { createHash } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { StageDef } from '@reefcraft/shared';
import { MemoryService } from '../artifact/memory.service';
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
} from '../db/schema/index';
import { canonicalJson } from '../json-schema/schema-hash';
import {
  computeInvalidationClosure,
  type InvalidationClosure,
  type InvalidationSeed,
} from './invalidation-closure';

export interface InvalidationCost {
  artifactId: string;
  stageKey: string;
  spentUsd: number;
  estimatedRerunUsd: number;
}

export interface InvalidationPreview {
  closure: InvalidationClosure;
  costs: InvalidationCost[];
  totals: { spentUsd: number; estimatedRerunUsd: number };
  fingerprint: string;
}

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

    const graphOrder = StageDef.array()
      .parse(runRow.graph)
      .map((stage) => stage.key);
    const executions = await this.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.runId, params.runId));
    const executionIds = executions.map((row) => row.id);
    const attempts =
      executionIds.length === 0
        ? []
        : await this.db
            .select()
            .from(stageAttempt)
            .where(inArray(stageAttempt.stageExecutionId, executionIds));

    const activeAttemptByExecution = new Map<string, (typeof attempts)[number]>();
    for (const execution of executions) {
      const candidates = attempts.filter((attempt) => attempt.stageExecutionId === execution.id);
      const active = execution.outputArtifactId
        ? candidates.find((attempt) => attempt.artifactId === execution.outputArtifactId)
        : undefined;
      const latest = candidates.reduce<(typeof attempts)[number] | undefined>(
        (current, attempt) =>
          !current || attempt.attemptNo > current.attemptNo ? attempt : current,
        undefined,
      );
      if (active ?? latest) activeAttemptByExecution.set(execution.id, (active ?? latest)!);
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
      executions: executions.map((execution) => ({
        stageKey: execution.stageKey,
        stageExecutionId: execution.id,
        ...(execution.outputArtifactId ? { artifactId: execution.outputArtifactId } : {}),
        provenance: (activeAttemptByExecution.get(execution.id)?.resolvedInputs ?? {}) as Record<
          string,
          never
        >,
      })),
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

    const costs = closure.affectedStageKeys.flatMap((stageKey) => {
      const execution = executions.find((row) => row.stageKey === stageKey);
      const row = affectedArtifacts.find(
        (candidate) => candidate.id === execution?.outputArtifactId,
      );
      if (!row) return [];
      const attempt = activeAttemptByArtifact.get(row.id);
      return [
        {
          artifactId: row.id,
          stageKey,
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

    for (const stageKey of params.closure.affectedStageKeys) {
      await tx
        .update(stageExecution)
        .set({
          state: 'stale',
          outputArtifactId: null,
          failure: null,
          endedAt: null,
          ...(stageKey === params.targetStageKey
            ? { generation: sql`${stageExecution.generation} + 1` }
            : {}),
        })
        .where(and(eq(stageExecution.runId, params.runId), eq(stageExecution.stageKey, stageKey)));
    }

    await this.memory.appendTombstones(
      tx,
      params.runId,
      params.closure.affectedStageKeys.map((stageKey) => ({ stageKey })),
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
