import { sql } from 'drizzle-orm';
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
  id: text('id').primaryKey(), // unique blueprint identifier
  channelId: text('channel_id')
    .notNull()
    .references(() => channel.id), // channel this blueprint belongs to
  name: text('name').notNull(), // display name of the blueprint
  description: text('description'), // freeform description shown on the blueprint card
  tags: text('tags').array().notNull().default([]), // freeform labels for search/filtering
  currentVersionId: text('current_version_id'), // id of the blueprint_version currently active (see FK note above)
  archived: boolean('archived').notNull().default(false), // whether the blueprint is archived/hidden from active use
  workingDraft: jsonb('working_draft'), // CreateBlueprintVersionDto: the canvas's autosaved unsaved edits; cleared on save
});

export const blueprintVersion = pgTable(
  'blueprint_version',
  {
    id: text('id').primaryKey(), // unique blueprint_version identifier
    blueprintId: text('blueprint_id')
      .notNull()
      .references(() => blueprint.id), // blueprint this version belongs to
    version: integer('version').notNull(), // monotonically increasing version number for the blueprint
    graph: jsonb('graph').notNull(), // StageDef[]: the pipeline stage graph for this version
    inputs: jsonb('inputs').notNull().default([]), // InputDef[]: input parameters a run of this version accepts
    roles: jsonb('roles').notNull().default([]), // RoleDef[]; v1 permits 0 or 1 (§18.5)
    defaults: jsonb('defaults').notNull(), // ConfigLayer: default config values for runs of this version
    budget: jsonb('budget').notNull(), // { runCapUsd }: spending limit for runs of this version
    validation: jsonb('validation').notNull(), // validation rules/results applied to this version's graph
    runnable: boolean('runnable').notNull().default(false), // whether this version has passed validation and can be run
    sourceTemplateId: text('source_template_id'), // template this version was generated from, if any
    createdAt: timestamptz('created_at').notNull().defaultNow(), // when this version was created
    draft: boolean('draft').notNull().default(false), // canvas run snapshot of unsaved edits: not in version history, never current; `version` = the saved version it was edited from
  },
  (t) => [
    uniqueIndex('blueprint_version_blueprint_id_version_uq')
      .on(t.blueprintId, t.version)
      .where(sql`draft = false`),
  ],
);
