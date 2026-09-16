import { sql } from 'drizzle-orm';
import { boolean, index, numeric, pgTable, text, timestamptz, uniqueIndex } from './pg-helpers';
import { run } from './run';
import { stageItem, stageAttempt } from './execution';

/** §3.12 */
export const ledgerEntry = pgTable(
  'ledger_entry',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => run.id),
    stageKey: text('stage_key').notNull(),
    stageItemId: text('stage_item_id').references(() => stageItem.id),
    stageAttemptId: text('stage_attempt_id').references(() => stageAttempt.id),
    kind: text('kind').notNull(), // reservation|actual|release
    category: text('category').notNull(), // stage_output|qc|check
    amountUsd: numeric('amount_usd', { precision: 12, scale: 4 }).notNull(),
    confirmed: boolean('confirmed').notNull().default(true), // false = provisional (§11.3)
    reservationId: text('reservation_id'),
    expiresAt: timestamptz('expires_at'), // clock starts at submit (§11.4)
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('ledger_open_idx')
      .on(t.runId, t.stageKey)
      .where(sql`${t.kind} = 'reservation'`),
    // One reservation per attempt, so a replayed step reuses rather than duplicates (§13.3)
    uniqueIndex('ledger_one_reservation_per_attempt')
      .on(t.stageAttemptId)
      .where(sql`${t.kind} = 'reservation'`),
  ],
);
