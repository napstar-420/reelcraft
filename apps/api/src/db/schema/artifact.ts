import { sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamptz,
  uniqueIndex,
} from './pg-helpers';
import { run } from './run';
import { blob } from './blob';

/** §4.1 — reused by `run_memory.kind` (memory writes are typed like artifacts). */
export const artifactKind = pgEnum('artifact_kind', [
  'data',
  'text',
  'media.image',
  'media.video',
  'media.audio',
  'file.subtitles',
  'timeline',
]);

export const reproLevelEnum = pgEnum('repro_level', ['exact', 'approximate', 'none']);

/**
 * §3.9 — artifacts are born stale (§3.9.1): every attempt writes one,
 * including failing attempts, so checks/QC have something to judge. Exactly
 * one transition flips `stale` false: finalizing a passing attempt, or a
 * manual edit superseding it, in the SAME transaction that marks the prior
 * active row stale. The partial unique index below cannot back a
 * DEFERRABLE constraint (Postgres limitation) — there is no end-of-transaction
 * escape, so every supersede path must stale-then-insert, in that order,
 * inside one transaction. See ArtifactService.finalize().
 */
export const artifact = pgTable(
  'artifact',
  {
    id: text('id').primaryKey(), // unique artifact identifier
    runId: text('run_id')
      .notNull()
      .references(() => run.id), // run this artifact was produced in
    producerStageKey: text('producer_stage_key').notNull(), // or '$input:<key>' (§6.2)
    itemIndex: integer('item_index'), // stage_item index this artifact belongs to, when iterating
    generation: integer('generation').notNull().default(0), // increments each time this producer/item slot is superseded
    kind: artifactKind('kind').notNull(),
    schemaHash: text('schema_hash'), // sha256 of canonical JSON Schema; null for fixed kinds
    data: jsonb('data'), // structured artifact payload, when not a blob-backed kind
    blobId: text('blob_id').references(() => blob.id), // underlying stored file backing this artifact, when media-based
    probe: jsonb('probe'), // media metadata, populated at write (§9.3)
    derived: jsonb('derived'), // firstFrame/lastFrame blob ids (§14.4)
    stale: boolean('stale').notNull().default(true), // born stale, §3.9.1
    userAuthored: boolean('user_authored').notNull().default(false), // whether a human manually authored/edited this artifact
    reproLevel: reproLevelEnum('repro_level').notNull(),
    repro: jsonb('repro'), // inputs/settings needed to reproduce this artifact
    costUsd: numeric('cost_usd', { precision: 12, scale: 4 }).notNull().default('0'), // cost incurred producing this artifact
    createdAt: timestamptz('created_at').notNull().defaultNow(), // when the artifact was created
  },
  (t) => [
    uniqueIndex('artifact_active_uq')
      .on(t.runId, t.producerStageKey, sql`coalesce(${t.itemIndex}, -1)`)
      .where(sql`${t.stale} = false`),
  ],
);
