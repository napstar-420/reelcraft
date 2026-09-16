import { jsonb, numeric, pgTable, text, timestamptz } from './pg-helpers';
import { channel } from './channel';
import { blueprintVersion } from './blueprint';

/** §3.7 — `role_bindings` and asset refs store full snapshots, not FKs, so
 * editing a Character or replacing a logo cannot retroactively change a past
 * run. */
export const run = pgTable('run', {
  id: text('id').primaryKey(),
  channelId: text('channel_id')
    .notNull()
    .references(() => channel.id),
  blueprintVersionId: text('blueprint_version_id')
    .notNull()
    .references(() => blueprintVersion.id),
  state: text('state').notNull(), // §12.1 RunState
  inputs: jsonb('inputs').notNull().default({}),
  roleBindings: jsonb('role_bindings').notNull().default({}),
  resolvedConfig: jsonb('resolved_config').notNull(), // flattened ConfigLayer at start
  overrides: jsonb('overrides').notNull().default({}), // sparse per-stage patch (§12.3)
  cursorStageKey: text('cursor_stage_key'),
  inngestRunId: text('inngest_run_id'),
  budgetCapUsd: numeric('budget_cap_usd', { precision: 12, scale: 4 }).notNull(),
  reservedUsd: numeric('reserved_usd', { precision: 12, scale: 4 }).notNull().default('0'),
  spentUsd: numeric('spent_usd', { precision: 12, scale: 4 }).notNull().default('0'),
  failure: jsonb('failure'),
  startedAt: timestamptz('started_at').notNull().defaultNow(),
  endedAt: timestamptz('ended_at'),
});
