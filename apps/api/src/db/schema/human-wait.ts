import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamptz,
  uniqueIndex,
} from './pg-helpers';
import { run } from './run';
import { stageExecution, stageItem } from './execution';

export const humanWaitKindEnum = pgEnum('human_wait_kind', ['approval', 'input', 'timeline_edit']);

/** Durable operator-attention state shared by approval and human-input gates. */
export const humanWait = pgTable(
  'human_wait',
  {
    id: text('id').primaryKey(), // unique human-wait record identifier
    runId: text('run_id')
      .notNull()
      .references(() => run.id), // run this wait gate belongs to
    stageExecutionId: text('stage_execution_id')
      .notNull()
      .references(() => stageExecution.id), // stage execution this wait gate blocks
    stageItemId: text('stage_item_id').references(() => stageItem.id), // specific stage item this wait gate blocks, if per-item
    kind: humanWaitKindEnum('kind').notNull(), // type of human gate
    draft: jsonb('draft'), // in-progress operator input/edits before submission
    draftRevision: integer('draft_revision').notNull().default(0), // increments each time the draft is saved
    draftUpdatedAt: timestamptz('draft_updated_at'), // when the draft was last saved
    waitingSince: timestamptz('waiting_since').notNull().defaultNow(), // when the gate started waiting on a human
    reminded24hAt: timestamptz('reminded_24h_at'), // when the 24-hour reminder notification was sent
    reminded48hAt: timestamptz('reminded_48h_at'), // when the 48-hour reminder notification was sent
    resolvedAt: timestamptz('resolved_at'), // when the human responded and the gate was resolved
  },
  (t) => [
    uniqueIndex('human_wait_open_execution_item_uq')
      .on(t.stageExecutionId, sql`coalesce(${t.stageItemId}, '')`)
      .where(sql`${t.resolvedAt} is null`),
    index('human_wait_reminder_idx').on(t.resolvedAt, t.waitingSince),
  ],
);
