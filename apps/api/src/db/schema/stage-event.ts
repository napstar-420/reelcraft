import { index, jsonb, integer, pgEnum, pgTable, text, timestamptz } from './pg-helpers';
import { run } from './run';
import { stageAttempt, stageExecution } from './execution';

export const stageEventLevelEnum = pgEnum('stage_event_level', ['debug', 'info', 'warn', 'error']);

/** Append-only, user-facing log of what a stage did during execution (the
 * stage "Logs" view). `id` is a monotonic ULID, so ordering by it is the
 * event order. */
export const stageEvent = pgTable(
  'stage_event',
  {
    id: text('id').primaryKey(), // monotonic ULID; sort key
    runId: text('run_id')
      .notNull()
      .references(() => run.id), // run this event belongs to
    stageExecutionId: text('stage_execution_id')
      .notNull()
      .references(() => stageExecution.id), // stage execution this event belongs to
    stageAttemptId: text('stage_attempt_id').references(() => stageAttempt.id), // attempt, when the event is attempt-scoped
    itemIndex: integer('item_index'), // item index, for iterating stages
    level: stageEventLevelEnum('level').notNull(), // debug | info | warn | error
    type: text('type').notNull(), // machine-readable event type, e.g. `prompt.rendered`
    message: text('message').notNull(), // human-readable one-line summary
    data: jsonb('data'), // structured detail (redacted, size-capped)
    createdAt: timestamptz('created_at').notNull(), // wall-clock time the event happened
  },
  (t) => [
    index('stage_event_execution_idx').on(t.stageExecutionId, t.id),
    index('stage_event_attempt_idx').on(t.stageAttemptId, t.id),
    index('stage_event_run_idx').on(t.runId),
  ],
);
