import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamptz, uniqueIndex } from './pg-helpers';
import { run } from './run';
import { stageExecution, stageItem } from './execution';

/** Durable operator-attention state shared by approval and human-input gates. */
export const humanWait = pgTable(
  'human_wait',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => run.id),
    stageExecutionId: text('stage_execution_id')
      .notNull()
      .references(() => stageExecution.id),
    stageItemId: text('stage_item_id').references(() => stageItem.id),
    kind: text('kind').notNull(),
    waitingSince: timestamptz('waiting_since').notNull().defaultNow(),
    reminded24hAt: timestamptz('reminded_24h_at'),
    reminded48hAt: timestamptz('reminded_48h_at'),
    resolvedAt: timestamptz('resolved_at'),
  },
  (t) => [
    uniqueIndex('human_wait_open_execution_item_uq')
      .on(t.stageExecutionId, sql`coalesce(${t.stageItemId}, '')`)
      .where(sql`${t.resolvedAt} is null`),
    index('human_wait_reminder_idx').on(t.resolvedAt, t.waitingSince),
  ],
);
