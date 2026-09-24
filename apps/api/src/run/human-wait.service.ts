import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type { HumanWaitKind } from '@reelcraft/shared';
import { ulid } from '../common/ulid';
import { DRIZZLE, type Db, type Tx } from '../db/drizzle.provider';
import { humanWait } from '../db/schema/index';

@Injectable()
export class HumanWaitService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async open(
    tx: Tx,
    input: {
      runId: string;
      stageExecutionId: string;
      stageItemId?: string;
      kind: HumanWaitKind;
    },
  ): Promise<void> {
    await tx
      .insert(humanWait)
      .values({ id: ulid(), ...input })
      .onConflictDoNothing();
  }

  async resolve(tx: Tx, stageExecutionId: string): Promise<void> {
    await tx
      .update(humanWait)
      .set({ resolvedAt: new Date().toISOString() })
      .where(and(eq(humanWait.stageExecutionId, stageExecutionId), isNull(humanWait.resolvedAt)));
  }

  async resolveAll(tx: Tx, runId: string): Promise<void> {
    await tx
      .update(humanWait)
      .set({ resolvedAt: new Date().toISOString() })
      .where(and(eq(humanWait.runId, runId), isNull(humanWait.resolvedAt)));
  }

  async findOpen(runId: string, stageExecutionId: string) {
    const [row] = await this.db
      .select()
      .from(humanWait)
      .where(
        and(
          eq(humanWait.runId, runId),
          eq(humanWait.stageExecutionId, stageExecutionId),
          isNull(humanWait.resolvedAt),
        ),
      )
      .limit(1);
    return row;
  }
}
