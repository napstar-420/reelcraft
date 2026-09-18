import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { ulid } from '../common/ulid';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { humanWait, run, runWakeup } from '../db/schema/index';
import { RunWakeupDispatcher } from './run-wakeup-dispatcher.service';

export function dueReminderThreshold(
  wait: { waitingSince: string; reminded24hAt: string | null; reminded48hAt: string | null },
  nowMs = Date.now(),
): 24 | 48 | null {
  const ageHours = (nowMs - Date.parse(wait.waitingSince)) / 3_600_000;
  if (ageHours >= 24 && wait.reminded24hAt === null) return 24;
  if (ageHours >= 48 && wait.reminded48hAt === null) return 48;
  return null;
}

@Injectable()
export class HumanReminderService {
  private readonly logger = new Logger(HumanReminderService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly dispatcher: RunWakeupDispatcher,
  ) {}

  async sweep(limit = 100): Promise<{ reminded: number }> {
    const candidates = await this.db
      .select({ id: humanWait.id })
      .from(humanWait)
      .where(isNull(humanWait.resolvedAt))
      .limit(limit);
    const wakeupIds: string[] = [];
    for (const candidate of candidates) {
      const wakeupId = await this.db.transaction(async (tx) => {
        const [wait] = await tx
          .select()
          .from(humanWait)
          .where(and(eq(humanWait.id, candidate.id), isNull(humanWait.resolvedAt)))
          .for('update');
        if (!wait) return null;
        const threshold = dueReminderThreshold(wait);
        if (threshold === null) return null;
        const [runRow] = await tx
          .select({ state: run.state, revision: run.revision })
          .from(run)
          .where(eq(run.id, wait.runId))
          .limit(1);
        if (!runRow) return null;
        const now = new Date().toISOString();
        await tx
          .update(humanWait)
          .set(threshold === 24 ? { reminded24hAt: now } : { reminded48hAt: now })
          .where(eq(humanWait.id, wait.id));
        const id = ulid();
        await tx.insert(runWakeup).values({
          id,
          runId: wait.runId,
          action: `attention_reminder_${threshold}h`,
          sourceState: runRow.state,
          expectedRevision: runRow.revision,
          eventName: 'run/attention-reminder',
        });
        return id;
      });
      if (wakeupId) wakeupIds.push(wakeupId);
    }
    for (const id of wakeupIds) {
      try {
        await this.dispatcher.dispatch(id);
      } catch (error) {
        this.logger.warn(
          `Reminder ${id} will be retried: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return { reminded: wakeupIds.length };
  }
}
