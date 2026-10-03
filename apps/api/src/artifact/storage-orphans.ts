import { inArray } from 'drizzle-orm';
import type { Db, Tx } from '../db/drizzle.provider';
import { blob, storageOrphan } from '../db/schema/index';

export type StorageOrphanReason =
  | 'channel_deleted'
  | 'blueprint_deleted'
  | 'character_deleted'
  | 'asset_deleted'
  | 'reference_deleted'
  | 'upload_rejected'
  | 'orphaned_prefix';

/** Queues stored objects for deletion by the `blob.gc` sweep, which removes
 * them once they have been queued for `BLOB_RETENTION_DAYS`. Call it in the
 * same transaction that deletes or soft-deletes the rows pointing at them. */
export async function queueStorageOrphans(
  db: Db | Tx,
  objectKeys: string[],
  reason: StorageOrphanReason,
): Promise<void> {
  const unique = [...new Set(objectKeys)];
  for (let start = 0; start < unique.length; start += 500) {
    await db
      .insert(storageOrphan)
      .values(unique.slice(start, start + 500).map((objectKey) => ({ objectKey, reason })))
      .onConflictDoNothing();
  }
}

/** Queues the objects of these blob rows (before the rows are deleted). */
export async function queueBlobObjects(
  db: Db | Tx,
  blobIds: string[],
  reason: StorageOrphanReason,
): Promise<void> {
  if (blobIds.length === 0) return;
  const rows = await db
    .select({ objectKey: blob.objectKey })
    .from(blob)
    .where(inArray(blob.id, blobIds));
  await queueStorageOrphans(
    db,
    rows.map((row) => row.objectKey),
    reason,
  );
}
