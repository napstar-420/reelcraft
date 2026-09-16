import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamptz,
  uniqueIndex,
} from './pg-helpers';
import { run } from './run';
import { artifact } from './artifact';

/** §3.11 — append-only for audit; the current value of a key is its
 * highest non-tombstoned version. */
export const runMemory = pgTable(
  'run_memory',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => run.id),
    memKey: text('mem_key').notNull(), // 'keyframe' or 'keyframe#3'
    version: integer('version').notNull(), // monotonic per (run_id, mem_key)
    writtenBy: text('written_by').notNull(), // stage_key
    writtenItem: integer('written_item'), // item index, when written from an iterating stage
    kind: text('kind').notNull(),
    schemaHash: text('schema_hash'),
    data: jsonb('data'), // resolved JSON for data/text writes
    artifactId: text('artifact_id').references(() => artifact.id), // media writes reference the artifact
    tombstone: boolean('tombstone').notNull().default(false), // value cleared by invalidation (§15.5)
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('run_memory_run_id_mem_key_version_uq').on(t.runId, t.memKey, t.version),
    index('run_memory_current').on(t.runId, t.memKey, t.version.desc()),
  ],
);
