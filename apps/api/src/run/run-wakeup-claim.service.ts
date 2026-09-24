import { Inject, Injectable } from '@nestjs/common';
import type { RunState } from '@reelcraft/shared';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
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
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly policy: RunActionPolicy,
  ) {}

  async claim(event: RunWakeupEventData): Promise<RunWakeupClaimResult> {
    return this.db.transaction(async (tx) => {
      const [wakeup] = await tx
        .select()
        .from(runWakeup)
        .where(eq(runWakeup.id, event.wakeupId))
        .for('update');
      if (!wakeup) return { claimed: false, reason: 'not_found' };
      if (wakeup.claimedAt !== null) return { claimed: false, reason: 'already_claimed' };

      if (
        wakeup.runId !== event.runId ||
        wakeup.action !== event.action ||
        wakeup.sourceState !== event.sourceState ||
        wakeup.expectedRevision !== event.expectedRevision
      ) {
        return { claimed: false, reason: 'event_mismatch' };
      }

      const [lockedRun] = await tx
        .select({ id: run.id, state: run.state, revision: run.revision })
        .from(run)
        .where(eq(run.id, event.runId))
        .for('update');
      if (!lockedRun) return { claimed: false, reason: 'run_not_found' };
      if (lockedRun.revision !== event.expectedRevision) {
        return { claimed: false, reason: 'stale_revision' };
      }
      if (lockedRun.state !== event.sourceState) {
        return { claimed: false, reason: 'stale_state' };
      }
      if (!isRunAction(wakeup.action)) {
        return { claimed: false, reason: 'action_disallowed' };
      }
      if (!this.policy.isAllowed(lockedRun.state as RunState, wakeup.action)) {
        return { claimed: false, reason: 'action_disallowed' };
      }

      const now = new Date().toISOString();
      await tx.update(run).set({ state: 'RUNNING', endedAt: null }).where(eq(run.id, event.runId));
      await tx.update(runWakeup).set({ claimedAt: now }).where(eq(runWakeup.id, event.wakeupId));
      return { claimed: true, runId: event.runId };
    });
  }
}
