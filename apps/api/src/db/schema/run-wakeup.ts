import { sql } from 'drizzle-orm';
import { bigint, index, integer, pgTable, text, timestamptz } from './pg-helpers';
import { run } from './run';

/** Transactional outbox for revision-bound run control events. The wakeup id
 * is also the Inngest event id, making a retry after an uncertain send safe. */
export const runWakeup = pgTable(
  'run_wakeup',
  {
    id: text('id').primaryKey(), // unique wakeup identifier, also used as the Inngest event id
    runId: text('run_id')
      .notNull()
      .references(() => run.id), // run this wakeup event is for
    action: text('action').notNull(), // orchestration action to perform on dispatch
    sourceState: text('source_state').notNull(), // run state the wakeup was created from, for staleness checks
    expectedRevision: bigint('expected_revision', { mode: 'number' }).notNull(), // run.revision this wakeup is conditioned on
    eventName: text('event_name').notNull(), // Inngest event name to dispatch
    dispatchAttemptCount: integer('dispatch_attempt_count').notNull().default(0), // number of times dispatch has been attempted
    lastError: text('last_error'), // error message from the most recent failed dispatch attempt
    createdAt: timestamptz('created_at').notNull().defaultNow(), // when the wakeup was enqueued
    dispatchedAt: timestamptz('dispatched_at'), // when the wakeup was successfully dispatched to Inngest
    claimedAt: timestamptz('claimed_at'), // when a dispatcher claimed this wakeup for processing
  },
  (t) => [
    index('run_wakeup_undispatched_idx')
      .on(t.createdAt)
      .where(sql`${t.dispatchedAt} is null`),
  ],
);
