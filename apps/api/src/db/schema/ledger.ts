import { sql } from 'drizzle-orm';
import { boolean, index, numeric, pgTable, text, timestamptz, uniqueIndex } from './pg-helpers';
import { run } from './run';
import { stageItem, stageAttempt } from './execution';

/** §3.12 */
export const ledgerEntry = pgTable(
  'ledger_entry',
  {
    id: text('id').primaryKey(), // unique ledger-entry identifier
    runId: text('run_id')
      .notNull()
      .references(() => run.id), // run this ledger entry belongs to
    stageKey: text('stage_key').notNull(), // stage key the spend/reservation is attributed to
    stageItemId: text('stage_item_id').references(() => stageItem.id), // stage item the spend/reservation is attributed to, when iterating
    stageAttemptId: text('stage_attempt_id').references(() => stageAttempt.id), // attempt the spend/reservation is attributed to
    kind: text('kind').notNull(), // reservation|actual|release
    category: text('category').notNull(), // stage_output|qc|check
    amountUsd: numeric('amount_usd', { precision: 12, scale: 4 }).notNull(), // dollar amount of this ledger entry
    confirmed: boolean('confirmed').notNull().default(true), // false = provisional (§11.3)
    reservationId: text('reservation_id'), // id linking a reservation to its later actual/release entries
    expiresAt: timestamptz('expires_at'), // clock starts at submit (§11.4)
    createdAt: timestamptz('created_at').notNull().defaultNow(), // when this ledger entry was recorded
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
