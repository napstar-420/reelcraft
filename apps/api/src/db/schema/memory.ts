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
import { artifact, artifactKind } from './artifact';

/** §3.11 — append-only for audit; the highest version is authoritative,
 * and a tombstone there makes the key absent without deleting history. */
export const runMemory = pgTable(
  'run_memory',
  {
    id: text('id').primaryKey(), // unique memory-entry identifier
    runId: text('run_id')
      .notNull()
      .references(() => run.id), // run this memory entry belongs to
    memKey: text('mem_key').notNull(), // 'keyframe' or 'keyframe#3'
    version: integer('version').notNull(), // monotonic per (run_id, mem_key)
    writtenBy: text('written_by').notNull(), // stage_key
    writtenItem: integer('written_item'), // item index, when written from an iterating stage
    kind: artifactKind('kind').notNull(), // type of value stored, same set as artifact.kind
    schemaHash: text('schema_hash'), // sha256 of canonical JSON Schema, when applicable
    data: jsonb('data'), // resolved JSON for data/text writes
    artifactId: text('artifact_id').references(() => artifact.id), // media writes reference the artifact
    tombstone: boolean('tombstone').notNull().default(false), // value cleared by invalidation (§15.5)
    createdAt: timestamptz('created_at').notNull().defaultNow(), // when this memory version was written
  },
  (t) => [
    uniqueIndex('run_memory_run_id_mem_key_version_uq').on(t.runId, t.memKey, t.version),
    index('run_memory_current').on(t.runId, t.memKey, t.version.desc()),
    index('run_memory_writer_idx').on(t.runId, t.writtenBy, t.writtenItem),
  ],
);
