import { index, pgTable, text, timestamptz } from './pg-helpers';

/** Stored objects whose database rows are gone (a deleted channel, blueprint
 * or character) or that belong to a deleted asset or reference image. The
 * `blob.gc` sweep deletes each object from storage once `queuedAt` is older
 * than `BLOB_RETENTION_DAYS`, then removes the row. No foreign keys: the rows
 * this outlives are already deleted. */
export const storageOrphan = pgTable(
  'storage_orphan',
  {
    objectKey: text('object_key').primaryKey(), // key of the object to delete from storage
    reason: text('reason').notNull(), // what made it an orphan, e.g. `channel_deleted`
    queuedAt: timestamptz('queued_at').notNull().defaultNow(), // when it was queued for deletion
  },
  (t) => [index('storage_orphan_queued_at_idx').on(t.queuedAt)],
);
