import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { RunState } from '@reefcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { run } from '../db/schema/index';
import { InProcessRunEvents } from './run-events';

@Injectable()
export class RunStateService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly events: InProcessRunEvents,
  ) {}

  async transition(runId: string, state: RunState): Promise<void> {
    const endedAt =
      state === 'COMPLETED' || state === 'FAILED' || state === 'CANCELLED'
        ? new Date().toISOString()
        : undefined;
    await this.db
      .update(run)
      .set({ state, ...(endedAt ? { endedAt } : {}) })
      .where(eq(run.id, runId));
    this.events.publish({ runId, type: 'state_changed', state });
  }

  async setCursor(runId: string, stageKey: string | null): Promise<void> {
    await this.db.update(run).set({ cursorStageKey: stageKey }).where(eq(run.id, runId));
  }
}
