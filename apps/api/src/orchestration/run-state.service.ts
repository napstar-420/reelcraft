import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { RunState } from '@reelcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { ulid } from '../common/ulid';
import { run, runWakeup, stageExecution } from '../db/schema/index';
import { LiveEvents } from '../live/live-events';

@Injectable()
export class RunStateService {
  private readonly logger = new Logger(RunStateService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly events: LiveEvents,
  ) {}

  async transition(runId: string, state: RunState): Promise<void> {
    const isTerminal = state === 'COMPLETED' || state === 'FAILED' || state === 'CANCELLED';
    const timestamps =
      state === 'RUNNING'
        ? { endedAt: null }
        : isTerminal
          ? { endedAt: new Date().toISOString() }
          : {};
    await this.db
      .update(run)
      .set({ state, ...timestamps })
      .where(eq(run.id, runId));
    this.logger.log({ runId, toState: state }, 'run state changed');
    this.events.publish({ type: 'run', runId });
  }

  /** Pauses a RUNNING run until `resumeAt` and queues the wakeup that resumes
   * it then (the dispatcher holds it back until `notBefore`). The wakeup is
   * bound to the run's revision, so a manual resume or any other operator
   * action in the meantime makes it stale and it is dropped. A run that is
   * no longer RUNNING (cancelled, paused by hand) is left alone. */
  async pauseForQuota(runId: string, resumeAt: string): Promise<void> {
    const paused = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(run)
        .set({ state: 'PAUSED_QUOTA' })
        .where(and(eq(run.id, runId), eq(run.state, 'RUNNING')))
        .returning({ revision: run.revision });
      if (!row) return false;
      await tx.insert(runWakeup).values({
        id: ulid(),
        runId,
        action: 'resume',
        sourceState: 'PAUSED_QUOTA',
        expectedRevision: row.revision,
        eventName: 'run/resumed',
        notBefore: resumeAt,
      });
      return true;
    });
    if (!paused) return;
    this.logger.log({ runId, toState: 'PAUSED_QUOTA', resumeAt }, 'run state changed');
    this.events.publish({ type: 'run', runId });
  }

  async setCursor(runId: string, stageKey: string | null): Promise<void> {
    await this.db.update(run).set({ cursorStageKey: stageKey }).where(eq(run.id, runId));
  }

  /** §16 — a stage whose "Enabled when" condition doesn't match the run's
   * input is marked `skipped` and never executed. */
  async skipStage(runId: string, stageExecutionId: string, stageKey: string): Promise<void> {
    await this.db
      .update(stageExecution)
      .set({ state: 'skipped', endedAt: new Date().toISOString() })
      .where(eq(stageExecution.id, stageExecutionId));
    this.logger.log({ runId, stageKey }, 'stage skipped: enabledWhen did not match');
    this.events.publish({ type: 'stage', runId, stageKey });
  }

  /** §12.4 — manual-pause runnability check: read without locking, since the
   * orchestrator only needs "should I start the next unit of work" here,
   * not a mutation precondition (that's `withLockedRun`'s job on the write
   * side). A `PAUSED_MANUAL` (or any other non-RUNNING) state means the
   * caller should stop before starting new work, leaving the cursor where
   * it is so a future resume re-enters at the same point. */
  async getState(runId: string): Promise<RunState | undefined> {
    const [row] = await this.db.select({ state: run.state }).from(run).where(eq(run.id, runId));
    return row?.state;
  }
}
