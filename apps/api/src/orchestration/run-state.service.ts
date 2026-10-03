import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { RunState } from '@reelcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { run, stageExecution } from '../db/schema/index';
import { InProcessRunEvents } from './run-events';

@Injectable()
export class RunStateService {
  private readonly logger = new Logger(RunStateService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly events: InProcessRunEvents,
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
    this.events.publish({ runId, type: 'state_changed', state });
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
