import { boolean, integer, jsonb, pgTable, text, timestamptz, uniqueIndex } from './pg-helpers';
import { channel } from './channel';

/**
 * §3.4 — `blueprint.current_version_id` and `blueprint_version.blueprint_id`
 * form a cycle, resolved because the former is nullable: insert blueprint,
 * insert version, update pointer. Drizzle will not infer this — declared
 * here WITHOUT a `.references()` call; the FK constraint is added by the
 * hand-written follow-up migration `drizzle/0001_blueprint_current_version_fk.sql`.
 * Do not add `.references()` here without also removing that migration.
 */
export const blueprint = pgTable('blueprint', {
  id: text('id').primaryKey(),
  channelId: text('channel_id')
    .notNull()
    .references(() => channel.id),
  name: text('name').notNull(),
  currentVersionId: text('current_version_id'),
  archived: boolean('archived').notNull().default(false),
});

export const blueprintVersion = pgTable(
  'blueprint_version',
  {
    id: text('id').primaryKey(),
    blueprintId: text('blueprint_id')
      .notNull()
      .references(() => blueprint.id),
    version: integer('version').notNull(),
    graph: jsonb('graph').notNull(), // StageDef[]
    inputs: jsonb('inputs').notNull().default([]), // InputDef[]
    roles: jsonb('roles').notNull().default([]), // RoleDef[]; v1 permits 0 or 1 (§18.5)
    defaults: jsonb('defaults').notNull(), // ConfigLayer
    budget: jsonb('budget').notNull(), // { runCapUsd }
    validation: jsonb('validation').notNull(),
    runnable: boolean('runnable').notNull().default(false),
    sourceTemplateId: text('source_template_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('blueprint_version_blueprint_id_version_uq').on(t.blueprintId, t.version)],
);
