import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { ArtifactKind } from '@reelcraft/shared';
import { ulid } from '../common/ulid';
import { fromUsd } from '../common/money';
import { DRIZZLE, type Db, type Tx } from '../db/drizzle.provider';
import { artifact, stageExecution, stageItem } from '../db/schema/index';

type Executor = Db | Tx;

export interface ArtifactRecord {
  kind: ArtifactKind;
  data: unknown;
  probe: unknown;
  runId: string;
  producerStageKey: string;
  itemIndex?: number | undefined;
}

export interface RecordAttemptArtifactInput {
  runId: string;
  producerStageKey: string;
  itemIndex?: number | undefined;
  kind: ArtifactKind;
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
  kind: ArtifactKind;
  data?: unknown;
  blobId?: string;
  probe?: unknown;
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

  /** Chunk 2 (§editor) — loads a single artifact row for `POST
   * checks/test`. There is no "collected" concept on `artifact` itself
   * (only `blob` rows are subject to GC/retention), so this is a plain
   * existence check. */
  async getById(artifactId: string): Promise<ArtifactRecord> {
    const [row] = await this.db.select().from(artifact).where(eq(artifact.id, artifactId)).limit(1);
    if (!row) throw new NotFoundException(`Artifact ${artifactId} not found`);
    return {
      kind: row.kind as ArtifactKind,
      data: row.data,
      probe: row.probe,
      runId: row.runId,
      producerStageKey: row.producerStageKey,
      itemIndex: row.itemIndex ?? undefined,
    };
  }

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
      probe: input.probe,
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
      itemIndex?: number | undefined;
      newArtifactId: string;
      /** phase 7 chunk 4 — when set, this finalize belongs to one item of
       * an iterating stage: `stage_item` (not `stage_execution`) gets the
       * new artifact/attemptCount/cost. `stage_execution`'s own
       * `outputArtifactId`/`attemptCount` are left untouched here — Locked
       * Decision 5/6 sets them once, separately, after every item has
       * passed (`StageRunnerService.finishIteratingStage`). */
      stageItemId?: string | undefined;
      /** phase 7 chunk 4 — mirrors `stage_execution.costUsd`'s sibling
       * column on `stage_item` (Locked Decision 5). Only meaningful
       * alongside `stageItemId`. */
      costUsd?: number | undefined;
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

      if (params.stageItemId) {
        await tx
          .update(stageItem)
          .set({
            state: 'passed',
            outputArtifactId: params.newArtifactId,
            attemptCount: sql`${stageItem.attemptCount} + 1`,
            ...(params.costUsd !== undefined && { costUsd: fromUsd(params.costUsd) }),
          })
          .where(eq(stageItem.id, params.stageItemId));
      } else {
        await tx
          .update(stageExecution)
          .set({
            outputArtifactId: params.newArtifactId,
            attemptCount: sql`${stageExecution.attemptCount} + 1`,
          })
          .where(eq(stageExecution.id, params.stageExecutionId));
      }

      if (params.applyWrites) await params.applyWrites(tx);
    };
    if (executor) {
      await apply(executor);
    } else {
      await this.db.transaction(apply);
    }
  }
}
