import { Inject, Injectable } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { HumanWaitKind } from '@reelcraft/shared';
import { ulid } from '../common/ulid';
import { DRIZZLE, type Db, type Tx } from '../db/drizzle.provider';
import { humanWait, stageExecution, stageItem } from '../db/schema/index';

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

  /** The open waits somebody can still answer. An open row alone is not
   * enough: an invalidation or an older version of the code can leave a wait
   * behind after its stage or item moved on. A stage-level wait is live while
   * its execution waits (`awaiting_approval` / `awaiting_input`); an item wait
   * while its item is `awaiting_approval`. */
  async liveOpenWaits(
    db: Db | Tx,
    runId: string,
  ): Promise<
    Array<{ id: string; stageExecutionId: string; stageItemId: string | null; kind: HumanWaitKind }>
  > {
    const rows = await db
      .select({
        id: humanWait.id,
        stageExecutionId: humanWait.stageExecutionId,
        stageItemId: humanWait.stageItemId,
        kind: humanWait.kind,
        executionState: stageExecution.state,
        itemState: stageItem.state,
      })
      .from(humanWait)
      .innerJoin(stageExecution, eq(humanWait.stageExecutionId, stageExecution.id))
      .leftJoin(stageItem, eq(humanWait.stageItemId, stageItem.id))
      .where(and(eq(humanWait.runId, runId), isNull(humanWait.resolvedAt)));
    return rows
      .filter((row) =>
        row.stageItemId === null
          ? row.executionState === 'awaiting_approval' || row.executionState === 'awaiting_input'
          : row.itemState === 'awaiting_approval',
      )
      .map(({ id, stageExecutionId, stageItemId, kind }) => ({
        id,
        stageExecutionId,
        stageItemId,
        kind,
      }));
  }

  async countOpenWaits(tx: Tx, runId: string): Promise<number> {
    return (await this.liveOpenWaits(tx, runId)).length;
  }

  /** The paused state that matches what the run waits for: approval before input. */
  async pausedStateFor(
    db: Db | Tx,
    runId: string,
  ): Promise<'PAUSED_APPROVAL' | 'PAUSED_INPUT' | undefined> {
    const waits = await this.liveOpenWaits(db, runId);
    if (waits.some((wait) => wait.kind === 'approval')) return 'PAUSED_APPROVAL';
    return waits.length > 0 ? 'PAUSED_INPUT' : undefined;
  }

  /** Whether any of the run's waits is still unanswered, live or not. */
  async anyUnanswered(db: Db | Tx, runId: string): Promise<boolean> {
    const [wait] = await db
      .select({ id: humanWait.id })
      .from(humanWait)
      .where(and(eq(humanWait.runId, runId), isNull(humanWait.resolvedAt)))
      .limit(1);
    return !!wait;
  }

  /** Throws unless this stage (or item) has a live open wait of `kind`. */
  async requireOpen(
    tx: Tx,
    executionId: string,
    kind: HumanWaitKind,
    stageItemId?: string,
  ): Promise<void> {
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

  /** After an invalidation: closes the waits nobody can answer any more
   * (their item or stage was reset), so a reject that restarted a stage
   * doesn't leave a wait behind. */
  async resolveNotLive(tx: Tx, runId: string): Promise<void> {
    const live = new Set((await this.liveOpenWaits(tx, runId)).map((wait) => wait.id));
    const open = await tx
      .select({ id: humanWait.id })
      .from(humanWait)
      .where(and(eq(humanWait.runId, runId), isNull(humanWait.resolvedAt)));
    const orphans = open.map((wait) => wait.id).filter((id) => !live.has(id));
    if (orphans.length === 0) return;
    await tx
      .update(humanWait)
      .set({ resolvedAt: new Date().toISOString() })
      .where(inArray(humanWait.id, orphans));
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
