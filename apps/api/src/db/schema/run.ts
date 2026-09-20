import { bigint, boolean, jsonb, numeric, pgTable, text, timestamptz } from './pg-helpers';
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
  /** Monotonic optimistic precondition for every operator mutation and
   * orchestration wakeup. Kept as bigint in Postgres while Drizzle exposes a
   * number: a run cannot practically approach Number.MAX_SAFE_INTEGER
   * mutations. */
  revision: bigint('revision', { mode: 'number' }).notNull().default(0),
  inputs: jsonb('inputs').notNull().default({}),
  roleBindings: jsonb('role_bindings').notNull().default({}),
  resolvedConfig: jsonb('resolved_config').notNull(), // Record<stageKey, ConfigLayer> at start (§5.3)
  overrides: jsonb('overrides').notNull().default({}), // sparse per-stage patch (§12.3)
  // §6.2 — Record<assetId, {blobId, kind}>, snapshotted at start() by walking
  // every {from:'asset'} ref in the graph. Read-only at run time
  // (BindingResolverService's 'asset' case never touches the live `asset`
  // table) so editing/replacing a channel asset can't retroactively change a
  // past run (§3.7's role_bindings/asset-ref guarantee, extended here).
  assetBindings: jsonb('asset_bindings').notNull().default({}),
  // Chunk 5 — a real run row driven through the unchanged async pipeline,
  // tagged so it's filterable out of "real work" run listings (locked
  // product decision #1).
  dryRun: boolean('dry_run').notNull().default(false),
  cursorStageKey: text('cursor_stage_key'),
  inngestRunId: text('inngest_run_id'),
  budgetCapUsd: numeric('budget_cap_usd', { precision: 12, scale: 4 }).notNull(),
  reservedUsd: numeric('reserved_usd', { precision: 12, scale: 4 }).notNull().default('0'),
  spentUsd: numeric('spent_usd', { precision: 12, scale: 4 }).notNull().default('0'),
  failure: jsonb('failure'),
  startedAt: timestamptz('started_at').notNull().defaultNow(),
  endedAt: timestamptz('ended_at'),
});
