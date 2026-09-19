import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { ulid } from '../common/ulid';
import { fromUsd } from '../common/money';
import { DRIZZLE, type Db, type Tx } from '../db/drizzle.provider';
import { artifact, stageExecution } from '../db/schema/index';

type Executor = Db | Tx;

export interface RecordAttemptArtifactInput {
  runId: string;
  producerStageKey: string;
  itemIndex?: number;
  kind: string;
  data?: unknown;
  blobId?: string;
  probe?: unknown;
  /** sha256 of the canonical output schema (§4.2) — only meaningful for
   * `kind: 'data'`; null for the fixed kinds. */
  schemaHash?: string;
  reproLevel: 'exact' | 'approximate' | 'none';
  repro?: unknown;
  costUsd: number;
  userAuthored?: boolean;
}

export interface RecordInputArtifactInput {
  runId: string;
  /** The declared `InputDef.key` — stored as `producerStageKey:
   * '$input:<key>'` (§6.2). */
  key: string;
  itemIndex?: number;
  kind: string;
  data?: unknown;
  blobId?: string;
  schemaHash?: string;
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

  async recordAttemptArtifact(
    input: RecordAttemptArtifactInput,
    executor: Executor = this.db,
  ): Promise<string> {
    const id = ulid();
    await executor.insert(artifact).values({
      id,
      runId: input.runId,
      producerStageKey: input.producerStageKey,
      itemIndex: input.itemIndex,
      kind: input.kind,
      data: input.data,
      blobId: input.blobId,
      probe: input.probe,
      schemaHash: input.schemaHash,
      stale: true,
      userAuthored: input.userAuthored ?? false,
      reproLevel: input.reproLevel,
      repro: input.repro,
      costUsd: fromUsd(input.costUsd),
    });
    return id;
  }

  /**
   * §6.2 — every declared run input becomes an artifact of its own, keyed by
   * the synthetic `producer_stage_key` `'$input:<key>'` so `{from:'prev'}`-
   * shaped provenance tracking (invalidation, chunk 2) has a real artifact
   * row to point at even though no stage produced it. Inserted directly with
   * `stale: false` — unlike `recordAttemptArtifact`, there is no prior
   * active row to supersede the first time an input is provided (a run's
   * inputs can't exist before the run itself does), so `finalize()`'s
   * stale-then-insert ordering doesn't apply here. Accepts an optional `tx`
   * so callers that need this in the same transaction as other writes (e.g.
   * `RunService.create()`) aren't forced into a second, separately-committed
   * statement.
   */
  async recordInputArtifact(
    input: RecordInputArtifactInput,
    executor: Executor = this.db,
  ): Promise<string> {
    const id = ulid();
    await executor.insert(artifact).values({
      id,
      runId: input.runId,
      producerStageKey: `$input:${input.key}`,
      itemIndex: input.itemIndex,
      kind: input.kind,
      data: input.data,
      blobId: input.blobId,
      schemaHash: input.schemaHash,
      stale: false,
      userAuthored: true,
      reproLevel: 'exact',
    });
    return id;
  }

  /**
   * Marks the prior active artifact stale, flips the new one active,
   * repoints stage_execution.output_artifact_id, and (if `applyWrites` is
   * given) runs the stage's Run Memory writes — all inside one transaction,
   * in that order. §6.3 requires memory writes to land in the SAME
   * transaction that finalizes a passing attempt; `applyWrites` is how
   * `MemoryService` (which cannot import `ArtifactService` without a module
   * cycle) gets a `tx` handle without owning the transaction boundary
   * itself. Never call outside a transaction; never reorder the writes.
   */
  async finalize(
    params: {
      runId: string;
      stageExecutionId: string;
      producerStageKey: string;
      itemIndex?: number;
      newArtifactId: string;
      applyWrites?: (tx: Tx) => Promise<void>;
    },
    executor?: Tx,
  ): Promise<void> {
    const apply = async (tx: Tx) => {
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

      if (params.applyWrites) await params.applyWrites(tx);
    };
    if (executor) {
      await apply(executor);
    } else {
      await this.db.transaction(apply);
    }
  }
}
