import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RunState } from '@reelcraft/shared';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { LiveEvents } from '../live/live-events';
import { NotificationService, type SentNotification } from '../notification/notification.service';
import { run, runWakeup } from '../db/schema/index';
import { RUN_ACTION_ALLOWED_STATES, RunActionPolicy, type RunAction } from './run-action-policy';

export interface RunWakeupEventData {
  wakeupId: string;
  runId: string;
  action: RunAction;
  sourceState: RunState;
  expectedRevision: number;
}

export type RunWakeupClaimResult =
  | { claimed: true; runId: string }
  | {
      claimed: false;
      reason:
        | 'not_found'
        | 'already_claimed'
        | 'event_mismatch'
        | 'run_not_found'
        | 'stale_revision'
        | 'stale_state'
        | 'action_disallowed';
    };

function isRunAction(value: string): value is RunAction {
  return Object.prototype.hasOwnProperty.call(RUN_ACTION_ALLOWED_STATES, value);
}

/** Atomically turns a persisted control event into RUNNING only when both the
 * event and current run still satisfy the original revision/state contract. */
@Injectable()
export class RunWakeupClaimService {
  private readonly logger = new Logger(RunWakeupClaimService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly policy: RunActionPolicy,
    private readonly events: LiveEvents,
    private readonly notifications: NotificationService,
  ) {}

  async claim(event: RunWakeupEventData): Promise<RunWakeupClaimResult> {
    const { result, sent } = await this.claimInTransaction(event);
    const ids = { runId: event.runId, wakeupId: event.wakeupId, action: event.action };
    if (result.claimed) {
      this.logger.debug(ids, 'run wakeup claimed');
      this.events.publish({ type: 'run', runId: event.runId });
      this.notifications.deliver(sent);
    } else if (result.reason === 'already_claimed')
      this.logger.debug(ids, 'run wakeup already claimed');
    else this.logger.warn({ ...ids, reason: result.reason }, 'run wakeup claim rejected');
    return result;
  }

  private claimInTransaction(
    event: RunWakeupEventData,
  ): Promise<{ result: RunWakeupClaimResult; sent?: SentNotification | null }> {
    return this.db.transaction(async (tx) => {
      const [wakeup] = await tx
        .select()
        .from(runWakeup)
        .where(eq(runWakeup.id, event.wakeupId))
        .for('update');
      if (!wakeup) return { result: { claimed: false, reason: 'not_found' } };
      if (wakeup.claimedAt !== null)
        return { result: { claimed: false, reason: 'already_claimed' } };

      if (
        wakeup.runId !== event.runId ||
        wakeup.action !== event.action ||
        wakeup.sourceState !== event.sourceState ||
        wakeup.expectedRevision !== event.expectedRevision
      ) {
        return { result: { claimed: false, reason: 'event_mismatch' } };
      }

      const [lockedRun] = await tx
        .select({ id: run.id, state: run.state, revision: run.revision })
        .from(run)
        .where(eq(run.id, event.runId))
        .for('update');
      if (!lockedRun) return { result: { claimed: false, reason: 'run_not_found' } };
      if (lockedRun.revision !== event.expectedRevision) {
        return { result: { claimed: false, reason: 'stale_revision' } };
      }
      if (lockedRun.state !== event.sourceState) {
        return { result: { claimed: false, reason: 'stale_state' } };
      }
      if (!isRunAction(wakeup.action)) {
        return { result: { claimed: false, reason: 'action_disallowed' } };
      }
      if (!this.policy.isAllowed(lockedRun.state as RunState, wakeup.action)) {
        return { result: { claimed: false, reason: 'action_disallowed' } };
      }

      const now = new Date().toISOString();
      await tx.update(run).set({ state: 'RUNNING', endedAt: null }).where(eq(run.id, event.runId));
      await tx.update(runWakeup).set({ claimedAt: now }).where(eq(runWakeup.id, event.wakeupId));
      // Started and auto-resumed notifications live here, in the claim itself:
      // the step that calls this is memoized, so a run already in flight when
      // the API restarts never re-announces a start that happened long ago.
      // Only the timed wakeup `pauseForQuota` queues carries `notBefore`, which
      // is what tells an automatic resume from the user pressing Resume.
      const kind =
        event.action === 'start'
          ? 'run_started'
          : event.action === 'resume' &&
              event.sourceState === 'PAUSED_QUOTA' &&
              wakeup.notBefore !== null
            ? 'auto_resumed'
            : null;
      const sent = kind
        ? await this.notifications.insertSafely(tx, {
            runId: event.runId,
            kind,
            dedupeKey: `${kind}:${event.wakeupId}`,
          })
        : null;
      return { result: { claimed: true, runId: event.runId }, sent };
    });
  }
}
