import { Inject, Injectable } from '@nestjs/common';
import type { Inngest } from 'inngest';
import { eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { runWakeup } from '../db/schema/index';
import { INNGEST_CLIENT } from '../orchestration/inngest.client';

/** Delivers committed outbox rows. A successful send whose DB acknowledgement
 * fails is safe to retry because the outbox id is reused as the Inngest id. */
@Injectable()
export class RunWakeupDispatcher {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(INNGEST_CLIENT) private readonly inngest: Inngest,
  ) {}

  async dispatch(wakeupId: string): Promise<boolean> {
    const [wakeup] = await this.db
      .select()
      .from(runWakeup)
      .where(eq(runWakeup.id, wakeupId))
      .limit(1);
    if (!wakeup || wakeup.dispatchedAt !== null) return false;

    await this.db
      .update(runWakeup)
      .set({
        dispatchAttemptCount: sql`${runWakeup.dispatchAttemptCount} + 1`,
        lastError: null,
      })
      .where(eq(runWakeup.id, wakeupId));

    try {
      await this.inngest.send({
        id: wakeup.id,
        name: wakeup.eventName,
        data: {
          wakeupId: wakeup.id,
          runId: wakeup.runId,
          action: wakeup.action,
          sourceState: wakeup.sourceState,
          expectedRevision: wakeup.expectedRevision,
        },
      });
    } catch (error) {
      await this.db
        .update(runWakeup)
        .set({ lastError: error instanceof Error ? error.message : String(error) })
        .where(eq(runWakeup.id, wakeupId));
      throw error;
    }

    await this.db
      .update(runWakeup)
      .set({ dispatchedAt: new Date().toISOString(), lastError: null })
      .where(eq(runWakeup.id, wakeupId));
    return true;
  }

  async dispatchPending(limit = 100): Promise<{ dispatched: number; failed: number }> {
    const pending = await this.db
      .select({ id: runWakeup.id })
      .from(runWakeup)
      .where(isNull(runWakeup.dispatchedAt))
      .limit(limit);

    let dispatched = 0;
    let failed = 0;
    for (const row of pending) {
      try {
        if (await this.dispatch(row.id)) dispatched += 1;
      } catch {
        failed += 1;
      }
    }
    return { dispatched, failed };
  }
}
