import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, pgTable, text, timestamptz } from './pg-helpers';
import { run } from './run';
import { character } from './character';

/**
 * §3.10 — only `scope = 'run'` is collectable by retention GC (§4.5). Input
 * blobs are the user's originals; character and asset blobs outlive runs.
 */
export const blob = pgTable(
  'blob',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull().default('local'),
    scope: text('scope').notNull(), // 'run' | 'input' | 'character' | 'asset'
    runId: text('run_id').references(() => run.id),
    characterId: text('character_id').references(() => character.id),
    bucket: text('bucket').notNull(),
    objectKey: text('object_key').notNull(),
    mime: text('mime').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    etag: text('etag'), // multipart ETags are not MD5
    gcEligible: boolean('gc_eligible').notNull().default(false),
    // MUST be set whenever gc_eligible flips true (§15.5)
    gcEligibleAt: timestamptz('gc_eligible_at'),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    check(
      'blob_scope_reference_ck',
      sql`(${t.scope} IN ('run','input') AND ${t.runId} IS NOT NULL)
          OR (${t.scope} = 'character' AND ${t.characterId} IS NOT NULL)
          OR (${t.scope} = 'asset')`,
    ),
    index('blob_gc_idx')
      .on(t.scope, t.gcEligibleAt)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);
