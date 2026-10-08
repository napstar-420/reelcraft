import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { HumanWaitKind } from '@reelcraft/shared';
import { ulid } from '../common/ulid';
import { DRIZZLE, type Db, type Tx } from '../db/drizzle.provider';
import { humanWait } from '../db/schema/index';

@Injectable()
export class HumanWaitService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async open(
    tx: Tx,
    input: {
      runId: string;
      stageExecutionId: string;
      stageItemId?: string;
      kind: HumanWaitKind;
    },
  ): Promise<void> {
    await tx
      .insert(humanWait)
      .values({ id: ulid(), ...input })
      .onConflictDoNothing();
  }

  /** Resolves the open waits of a stage execution, or only the one for
   * `stageItemId` when given (an iterating stage can have several items
   * waiting at once). */
  async resolve(tx: Tx, stageExecutionId: string, stageItemId?: string): Promise<void> {
    await tx
      .update(humanWait)
      .set({ resolvedAt: new Date().toISOString() })
      .where(
        and(
          eq(humanWait.stageExecutionId, stageExecutionId),
          isNull(humanWait.resolvedAt),
          stageItemId ? eq(humanWait.stageItemId, stageItemId) : undefined,
        ),
      );
  }

  /** After an invalidation: closes the waits of items that are no longer
   * waiting, so a reject that restarted the stage doesn't leave a wait nobody
   * can answer. */
  async resolveForItemsNoLongerWaiting(tx: Tx, runId: string): Promise<void> {
    await tx.execute(sql`
      update human_wait set resolved_at = now()
      where run_id = ${runId} and resolved_at is null and stage_item_id is not null
        and stage_item_id in (select id from stage_item where state <> 'awaiting_approval')`);
  }

  /** How many approval waits of the run are still open. */
  async countOpenApprovals(tx: Tx, runId: string): Promise<number> {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(humanWait)
      .where(
        and(
          eq(humanWait.runId, runId),
          eq(humanWait.kind, 'approval'),
          isNull(humanWait.resolvedAt),
        ),
      );
    return row?.count ?? 0;
  }

  async resolveAll(tx: Tx, runId: string): Promise<void> {
    await tx
      .update(humanWait)
      .set({ resolvedAt: new Date().toISOString() })
      .where(and(eq(humanWait.runId, runId), isNull(humanWait.resolvedAt)));
  }

  async findOpen(runId: string, stageExecutionId: string) {
    const [row] = await this.db
      .select()
      .from(humanWait)
      .where(
        and(
          eq(humanWait.runId, runId),
          eq(humanWait.stageExecutionId, stageExecutionId),
          isNull(humanWait.resolvedAt),
        ),
      )
      .limit(1);
    return row;
  }
}
