import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { RunState } from '@reelcraft/shared';
import { DRIZZLE, type Db, type Tx } from '../db/drizzle.provider';
import { ulid } from '../common/ulid';
import { run, runWakeup, stageExecution } from '../db/schema/index';
import { LiveEvents } from '../live/live-events';
import type { RunWakeupEventData } from '../run/run-wakeup-claim.service';

/** A queued wakeup, as the event that delivers it. */
export type RunWakeupEvent = RunWakeupEventData & { executionEpoch: number; executionKey: string };

@Injectable()
export class RunStateService {
  private readonly logger = new Logger(RunStateService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly events: LiveEvents,
  ) {}

  async admitLegacy(runId: string, executionEpoch: number): Promise<boolean> {
    const updated = await this.db
      .update(run)
      .set({ state: 'RUNNING', endedAt: null })
      .where(
        and(
          eq(run.id, runId),
          eq(run.executionEpoch, executionEpoch),
          inArray(run.state, [
            'CREATED',
            'RUNNING',
            'PAUSED_MANUAL',
            'PAUSED_BUDGET',
            'PAUSED_INPUT',
            'PAUSED_APPROVAL',
            'PAUSED_QUOTA',
            'FAILED',
          ]),
        ),
      )
      .returning({ id: run.id });
    if (updated.length) this.events.publish({ type: 'run', runId });
    return updated.length > 0;
  }

  async transition(runId: string, state: RunState, epoch?: number): Promise<void> {
    const isTerminal =
      state === 'COMPLETED' || state === 'FAILED' || state === 'CANCELLED' || state === 'IDLE';
    const timestamps =
      state === 'RUNNING'
        ? { endedAt: null }
        : isTerminal
          ? { endedAt: new Date().toISOString() }
          : {};
    await this.db
      .update(run)
      .set({
        state:
          epoch === undefined
            ? state
            : sql`case when ${run.state} = 'PAUSING' then 'PAUSED_MANUAL'::run_state else ${state}::run_state end`,
        ...timestamps,
      })
      .where(
        and(
          eq(run.id, runId),
          ...(epoch === undefined
            ? []
            : [eq(run.executionEpoch, epoch), inArray(run.state, ['RUNNING', 'PAUSING'])]),
        ),
      );
    this.logger.log({ runId, toState: state }, 'run state changed');
    this.events.publish({ type: 'run', runId });
  }

  /** Parks a RUNNING run on the waits still open, read by `openState` under the run's lock. An
   * approval can arrive while the run is still running other stages; if every wait was answered
   * that way, there is nothing left to park on, so the run parks and queues its own resume, as an
   * answer to a parked run would. A run no longer RUNNING in `epoch` is left alone. */
  async parkOnWaits(
    runId: string,
    epoch: number,
    fallback: 'PAUSED_APPROVAL' | 'PAUSED_INPUT',
    openState: (tx: Tx) => Promise<'PAUSED_APPROVAL' | 'PAUSED_INPUT' | undefined>,
  ): Promise<{ state: RunState; resume?: RunWakeupEvent }> {
    const result = await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ state: run.state, epoch: run.executionEpoch, revision: run.revision })
        .from(run)
        .where(eq(run.id, runId))
        .for('update');
      if (!locked || locked.epoch !== epoch || !['RUNNING', 'PAUSING'].includes(locked.state)) {
        return { state: fallback as RunState };
      }
      if (locked.state === 'PAUSING') {
        await tx.update(run).set({ state: 'PAUSED_MANUAL' }).where(eq(run.id, runId));
        return { state: 'PAUSED_MANUAL' as RunState };
      }
      const open = await openState(tx);
      if (open) {
        await tx.update(run).set({ state: open }).where(eq(run.id, runId));
        return { state: open as RunState };
      }
      const [parked] = await tx
        .update(run)
        .set({ state: 'PAUSED_APPROVAL', executionEpoch: sql`${run.executionEpoch} + 1` })
        .where(eq(run.id, runId))
        .returning({ revision: run.revision, executionEpoch: run.executionEpoch });
      const resume: RunWakeupEvent = {
        wakeupId: ulid(),
        runId,
        action: 'approve',
        sourceState: 'PAUSED_APPROVAL',
        expectedRevision: parked!.revision,
        executionEpoch: parked!.executionEpoch,
        executionKey: `${runId}:${parked!.executionEpoch}`,
      };
      await tx.insert(runWakeup).values({
        id: resume.wakeupId,
        runId,
        action: resume.action,
        sourceState: resume.sourceState,
        expectedRevision: resume.expectedRevision,
        executionEpoch: resume.executionEpoch,
        eventName: 'run/resumed',
      });
      return { state: 'PAUSED_APPROVAL' as RunState, resume };
    });
    this.logger.log(
      { runId, toState: result.state, resumes: Boolean(result.resume) },
      'run state changed',
    );
    this.events.publish({ type: 'run', runId });
    return result;
  }

  /** Pauses a RUNNING run until `resumeAt` and queues the wakeup that resumes
   * it then (the dispatcher holds it back until `notBefore`). The wakeup is
   * bound to the run's revision, so a manual resume or any other operator
   * action in the meantime makes it stale and it is dropped. A run that is
   * no longer RUNNING (cancelled, paused by hand) is left alone. */
  async pauseForQuota(runId: string, resumeAt: string, epoch?: number): Promise<boolean> {
    const paused = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(run)
        .set({ state: 'PAUSED_QUOTA', executionEpoch: sql`${run.executionEpoch} + 1` })
        .where(
          and(
            eq(run.id, runId),
            eq(run.state, 'RUNNING'),
            ...(epoch === undefined ? [] : [eq(run.executionEpoch, epoch)]),
          ),
        )
        .returning({ revision: run.revision, executionEpoch: run.executionEpoch });
      if (!row) return false;
      await tx.insert(runWakeup).values({
        id: ulid(),
        runId,
        action: 'resume',
        sourceState: 'PAUSED_QUOTA',
        expectedRevision: row.revision,
        executionEpoch: row.executionEpoch,
        eventName: 'run/resumed',
        notBefore: resumeAt,
      });
      return true;
    });
    if (!paused) return false;
    this.logger.log({ runId, toState: 'PAUSED_QUOTA', resumeAt }, 'run state changed');
    this.events.publish({ type: 'run', runId });
    return true;
  }

  async setCursor(runId: string, stageKey: string | null, executionEpoch?: number): Promise<void> {
    await this.db
      .update(run)
      .set({ cursorStageKey: stageKey })
      .where(
        and(
          eq(run.id, runId),
          executionEpoch === undefined ? undefined : eq(run.executionEpoch, executionEpoch),
        ),
      );
  }

  /** §16 — a stage whose "Enabled when" condition doesn't match the run's
   * input is marked `skipped` and never executed. */
  async skipStage(
    runId: string,
    stageExecutionId: string,
    stageKey: string,
    epoch?: number,
    reason = 'Disabled by Enabled when condition',
  ): Promise<void> {
    await this.db
      .update(stageExecution)
      .set({
        state: 'skipped',
        skipReason: reason,
        endedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(stageExecution.id, stageExecutionId),
          epoch === undefined
            ? undefined
            : sql`exists (select 1 from ${run} where ${run.id} = ${runId} and ${run.executionEpoch} = ${epoch} and ${run.state} = 'RUNNING')`,
        ),
      );
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
