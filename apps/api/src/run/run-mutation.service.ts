import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { RunState } from '@reelcraft/shared';
import { eq, sql } from 'drizzle-orm';
import { ulid } from '../common/ulid';
import { DRIZZLE, type Db, type Tx } from '../db/drizzle.provider';
import { run, runWakeup } from '../db/schema/index';
import { RunActionPolicy, type RunAction } from './run-action-policy';

export interface LockedRunMutationResult<T> {
  value: T;
  revision: number;
  wakeupId: string;
}

/** Serializes logical operator mutations on the run row. The domain mutation,
 * single revision bump, and wakeup insert all commit (or roll back) together. */
@Injectable()
export class RunMutationService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly policy: RunActionPolicy,
  ) {}

  async withLockedRun<T>(
    runId: string,
    action: RunAction,
    allowedStates: readonly RunState[],
    callback: (tx: Tx, lockedRun: typeof run.$inferSelect) => Promise<T>,
    eventName = 'run/wakeup',
  ): Promise<LockedRunMutationResult<T>> {
    return this.db.transaction(async (tx) => {
      const [lockedRun] = await tx.select().from(run).where(eq(run.id, runId)).for('update');
      if (!lockedRun) throw new NotFoundException(`Run ${runId} not found`);

      const sourceState = lockedRun.state as RunState;
      this.policy.assertAllowed(sourceState, action, allowedStates);

      const value = await callback(tx, lockedRun);
      const [updated] = await tx
        .update(run)
        .set({ revision: sql`${run.revision} + 1` })
        .where(eq(run.id, runId))
        .returning({ revision: run.revision });
      if (!updated) throw new NotFoundException(`Run ${runId} disappeared during mutation`);

      const wakeupId = ulid();
      await tx.insert(runWakeup).values({
        id: wakeupId,
        runId,
        action,
        sourceState,
        expectedRevision: updated.revision,
        eventName,
      });

      return { value, revision: updated.revision, wakeupId };
    });
  }
}
