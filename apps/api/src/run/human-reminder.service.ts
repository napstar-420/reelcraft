import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, isNull, lte, or } from 'drizzle-orm';
import { DRIZZLE, type Db, type Tx } from '../db/drizzle.provider';
import { humanWait, run, stageExecution } from '../db/schema/index';
import { NotificationService, type SentNotification } from '../notification/notification.service';

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
    private readonly notifications: NotificationService,
  ) {}

  /** Records a "still waiting for you" notification for each open human wait
   * that has crossed 24 h or 48 h. The wait row is locked, so each threshold is
   * decided exactly once; the notification is written in the same transaction as
   * the `reminded_*` stamp, so a failure leaves the wait due for the next sweep. */
  async sweep(limit = 100): Promise<{ reminded: number }> {
    // Only waits that are due now (the same rule as `dueReminderThreshold`),
    // oldest first, so waits that need nothing can never use up the limit.
    const now = Date.now();
    const age24 = new Date(now - 24 * 3_600_000).toISOString();
    const age48 = new Date(now - 48 * 3_600_000).toISOString();
    const candidates = await this.db
      .select({ id: humanWait.id })
      .from(humanWait)
      .where(
        and(
          isNull(humanWait.resolvedAt),
          or(
            and(isNull(humanWait.reminded24hAt), lte(humanWait.waitingSince, age24)),
            and(isNull(humanWait.reminded48hAt), lte(humanWait.waitingSince, age48)),
          ),
        ),
      )
      .orderBy(asc(humanWait.waitingSince))
      .limit(limit);
    const sent: SentNotification[] = [];
    for (const candidate of candidates) {
      try {
        const reminder = await this.db.transaction((tx) => this.remind(tx, candidate.id));
        if (reminder) sent.push(reminder);
      } catch (error) {
        this.logger.warn({ waitId: candidate.id, err: error }, 'human wait reminder failed');
      }
    }
    for (const reminder of sent) this.notifications.deliver(reminder);
    if (sent.length > 0) this.logger.log({ reminded: sent.length }, 'human wait reminders sent');
    return { reminded: sent.length };
  }

  private async remind(tx: Tx, waitId: string): Promise<SentNotification | null> {
    const [wait] = await tx
      .select()
      .from(humanWait)
      .where(and(eq(humanWait.id, waitId), isNull(humanWait.resolvedAt)))
      .for('update');
    if (!wait) return null;
    const threshold = dueReminderThreshold(wait);
    if (threshold === null) return null;
    const [runRow] = await tx
      .select({ id: run.id })
      .from(run)
      .where(eq(run.id, wait.runId))
      .limit(1);
    if (!runRow) return null;
    const [execution] = await tx
      .select({ stageKey: stageExecution.stageKey })
      .from(stageExecution)
      .where(eq(stageExecution.id, wait.stageExecutionId))
      .limit(1);
    await tx
      .update(humanWait)
      .set(
        threshold === 24
          ? { reminded24hAt: new Date().toISOString() }
          : { reminded48hAt: new Date().toISOString() },
      )
      .where(eq(humanWait.id, wait.id));
    return this.notifications.insertForRun(tx, {
      runId: wait.runId,
      kind: 'reminder',
      dedupeKey: `reminder:${wait.id}:${threshold}`,
      ...(execution && { stageKey: execution.stageKey }),
      waitKind: wait.kind,
      hours: threshold,
    });
  }
}
