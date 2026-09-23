import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamptz,
  uniqueIndex,
} from './pg-helpers';

export const templateSourceEnum = pgEnum('template_source', ['builtin', 'user']);
export const templateKindEnum = pgEnum('template_kind', ['blueprint', 'schema', 'check', 'stage']);

/** §20 — immutable versions, matching the Blueprint model. `source =
 * 'builtin'` marks engine-shipped presets seeded on migration. */
export const template = pgTable(
  'template',
  {
    id: text('id').primaryKey(), // unique template identifier
    ownerId: text('owner_id').notNull().default('local'), // account that owns this template
    source: templateSourceEnum('source').notNull(),
    kind: templateKindEnum('kind').notNull(),
    name: text('name').notNull(), // template name, unique within owner+kind
    description: text('description').notNull().default(''), // human-readable summary of the template
    tags: text('tags').array().notNull().default([]), // freeform labels for search/filtering
    archived: boolean('archived').notNull().default(false), // whether the template is archived/hidden from active use
  },
  (t) => [uniqueIndex('template_owner_id_kind_name_uq').on(t.ownerId, t.kind, t.name)],
);

export const templateVersion = pgTable(
  'template_version',
  {
    id: text('id').primaryKey(), // unique template_version identifier
    templateId: text('template_id')
      .notNull()
      .references(() => template.id), // template this version belongs to
    version: integer('version').notNull(), // monotonically increasing version number for the template
    body: jsonb('body').notNull(), // StageDef[] | JsonSchema | CheckDef | StageDef
    requires: jsonb('requires').notNull().default({}), // { capabilities: [], inputs: InputDef[] }
    createdAt: timestamptz('created_at').notNull().defaultNow(), // when this version was created
  },
  (t) => [uniqueIndex('template_version_template_id_version_uq').on(t.templateId, t.version)],
);
