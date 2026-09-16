import { boolean, integer, jsonb, pgTable, text, timestamptz, uniqueIndex } from './pg-helpers';

/** §20 — immutable versions, matching the Blueprint model. `source =
 * 'builtin'` marks engine-shipped presets seeded on migration. */
export const template = pgTable(
  'template',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull().default('local'),
    source: text('source').notNull(), // 'builtin' | 'user'
    kind: text('kind').notNull(), // 'blueprint' | 'schema' | 'check' | 'stage'
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    tags: text('tags').array().notNull().default([]),
    archived: boolean('archived').notNull().default(false),
  },
  (t) => [uniqueIndex('template_owner_id_kind_name_uq').on(t.ownerId, t.kind, t.name)],
);

export const templateVersion = pgTable(
  'template_version',
  {
    id: text('id').primaryKey(),
    templateId: text('template_id')
      .notNull()
      .references(() => template.id),
    version: integer('version').notNull(),
    body: jsonb('body').notNull(), // StageDef[] | JsonSchema | CheckDef | StageDef
    requires: jsonb('requires').notNull().default({}), // { capabilities: [], inputs: InputDef[] }
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('template_version_template_id_version_uq').on(t.templateId, t.version)],
);
