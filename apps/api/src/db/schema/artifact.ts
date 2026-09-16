import { sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamptz,
  uniqueIndex,
} from './pg-helpers';
import { run } from './run';
import { blob } from './blob';

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
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => run.id),
    producerStageKey: text('producer_stage_key').notNull(), // or '$input:<key>' (§6.2)
    itemIndex: integer('item_index'),
    generation: integer('generation').notNull().default(0),
    kind: text('kind').notNull(), // §4.1
    schemaHash: text('schema_hash'), // sha256 of canonical JSON Schema; null for fixed kinds
    data: jsonb('data'),
    blobId: text('blob_id').references(() => blob.id),
    probe: jsonb('probe'), // media metadata, populated at write (§9.3)
    derived: jsonb('derived'), // firstFrame/lastFrame blob ids (§14.4)
    stale: boolean('stale').notNull().default(true), // born stale, §3.9.1
    userAuthored: boolean('user_authored').notNull().default(false),
    reproLevel: text('repro_level').notNull(), // exact|approximate|none
    repro: jsonb('repro'),
    costUsd: numeric('cost_usd', { precision: 12, scale: 4 }).notNull().default('0'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('artifact_active_uq')
      .on(t.runId, t.producerStageKey, sql`coalesce(${t.itemIndex}, -1)`)
      .where(sql`${t.stale} = false`),
  ],
);
