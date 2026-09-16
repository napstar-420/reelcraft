import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { ulid } from '../common/ulid';
import { fromUsd } from '../common/money';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { ledgerEntry, run } from '../db/schema/index';

/**
 * §8/§11 — phase 1 records `actual` entries only, without reserving.
 * Reserve-then-reconcile (§11) is phase 3; the ledger table and this
 * service exist now so the call sites don't move later.
 */
@Injectable()
export class LedgerService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async recordActual(params: {
    runId: string;
    stageKey: string;
    stageAttemptId?: string;
    category: 'stage_output' | 'qc' | 'check';
    amountUsd: number;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(ledgerEntry).values({
        id: ulid(),
        runId: params.runId,
        stageKey: params.stageKey,
        stageAttemptId: params.stageAttemptId,
        kind: 'actual',
        category: params.category,
        amountUsd: fromUsd(params.amountUsd),
        confirmed: true,
      });
      await tx
        .update(run)
        .set({ spentUsd: sql`${run.spentUsd} + ${fromUsd(params.amountUsd)}` })
        .where(eq(run.id, params.runId));
    });
  }
}
