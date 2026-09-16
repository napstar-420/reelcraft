import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { ulid } from '../common/ulid';
import { fromUsd } from '../common/money';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { artifact, stageExecution } from '../db/schema/index';

export interface RecordAttemptArtifactInput {
  runId: string;
  producerStageKey: string;
  itemIndex?: number;
  kind: string;
  data?: unknown;
  blobId?: string;
  reproLevel: 'exact' | 'approximate' | 'none';
  repro?: unknown;
  costUsd: number;
}

/**
 * §3.9.1/§15.4 — artifacts are born stale (every attempt writes one,
 * including failing attempts). Exactly one transition flips `stale` false:
 * finalize(). The partial unique index `artifact_active_uq` cannot back a
 * DEFERRABLE constraint, so ordering inside the transaction is not
 * negotiable — mark the predecessor stale BEFORE inserting the replacement.
 * This is the only method in the codebase allowed to flip `stale` to false;
 * every supersede path must call it.
 */
@Injectable()
export class ArtifactService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async recordAttemptArtifact(input: RecordAttemptArtifactInput): Promise<string> {
    const id = ulid();
    await this.db.insert(artifact).values({
      id,
      runId: input.runId,
      producerStageKey: input.producerStageKey,
      itemIndex: input.itemIndex,
      kind: input.kind,
      data: input.data,
      blobId: input.blobId,
      stale: true,
      reproLevel: input.reproLevel,
      repro: input.repro,
      costUsd: fromUsd(input.costUsd),
    });
    return id;
  }

  /**
   * Marks the prior active artifact stale, flips the new one active, and
   * repoints stage_execution.output_artifact_id — all inside one
   * transaction, in that order. Never call outside a transaction; never
   * reorder the two writes.
   */
  async finalize(params: {
    runId: string;
    stageExecutionId: string;
    producerStageKey: string;
    itemIndex?: number;
    newArtifactId: string;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(artifact)
        .set({ stale: true })
        .where(
          and(
            eq(artifact.runId, params.runId),
            eq(artifact.producerStageKey, params.producerStageKey),
            params.itemIndex === undefined
              ? isNull(artifact.itemIndex)
              : eq(artifact.itemIndex, params.itemIndex),
            eq(artifact.stale, false),
          ),
        );

      await tx.update(artifact).set({ stale: false }).where(eq(artifact.id, params.newArtifactId));

      await tx
        .update(stageExecution)
        .set({
          outputArtifactId: params.newArtifactId,
          attemptCount: sql`${stageExecution.attemptCount} + 1`,
        })
        .where(eq(stageExecution.id, params.stageExecutionId));
    });
  }
}
