import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, jsonb, pgTable, text, timestamptz } from './pg-helpers';
import { run } from './run';
import { character } from './character';

/**
 * §3.10 — only `scope = 'run'` is collectable by retention GC (§4.5). Input
 * blobs are the user's originals; character and asset blobs outlive runs.
 */
export const blob = pgTable(
  'blob',
  {
    id: text('id').primaryKey(), // unique blob identifier
    ownerId: text('owner_id').notNull().default('local'), // account that owns this blob
    scope: text('scope').notNull(), // 'run' | 'input' | 'character' | 'asset'
    runId: text('run_id').references(() => run.id), // owning run, required when scope is 'run' or 'input'
    characterId: text('character_id').references(() => character.id), // owning character, required when scope is 'character'
    bucket: text('bucket').notNull(), // storage bucket the object lives in
    objectKey: text('object_key').notNull(), // key/path of the object within the bucket
    mime: text('mime').notNull(), // MIME type of the stored object
    bytes: bigint('bytes', { mode: 'number' }).notNull(), // size of the stored object in bytes
    sha256: text('sha256').notNull(), // content hash, used for dedup/integrity checks
    etag: text('etag'), // multipart ETags are not MD5
    probe: jsonb('probe'), // normalized ffprobe metadata for uploaded media
    gcEligible: boolean('gc_eligible').notNull().default(false), // whether retention GC may reclaim this blob
    // MUST be set whenever gc_eligible flips true (§15.5)
    gcEligibleAt: timestamptz('gc_eligible_at'), // when the blob became eligible for GC
    deletedAt: timestamptz('deleted_at'), // when the blob was soft-deleted, if it has been
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
