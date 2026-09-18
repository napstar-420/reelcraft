import { sql } from 'drizzle-orm';
import { bigint, index, integer, pgTable, text, timestamptz } from './pg-helpers';
import { run } from './run';

/** Transactional outbox for revision-bound run control events. The wakeup id
 * is also the Inngest event id, making a retry after an uncertain send safe. */
export const runWakeup = pgTable(
  'run_wakeup',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => run.id),
    action: text('action').notNull(),
    sourceState: text('source_state').notNull(),
    expectedRevision: bigint('expected_revision', { mode: 'number' }).notNull(),
    eventName: text('event_name').notNull(),
    dispatchAttemptCount: integer('dispatch_attempt_count').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    dispatchedAt: timestamptz('dispatched_at'),
    claimedAt: timestamptz('claimed_at'),
  },
  (t) => [
    index('run_wakeup_undispatched_idx')
      .on(t.createdAt)
      .where(sql`${t.dispatchedAt} is null`),
  ],
);
