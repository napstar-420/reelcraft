import { inArray } from 'drizzle-orm';
import type { Tx } from '../db/drizzle.provider';
import {
  artifact,
  artifactAttachment,
  blob,
  humanWait,
  ledgerEntry,
  notification,
  run,
  runMemory,
  runWakeup,
  stageAttempt,
  stageEvent,
  stageExecution,
  stageItem,
} from '../db/schema/index';
import { queueStorageOrphans, type StorageOrphanReason } from '../artifact/storage-orphans';

/**
 * Permanently deletes runs and every row that references them, in foreign-key
 * order, and queues their stored files for the storage cleanup sweep. Shared
 * by `ChannelService.delete()` and `BlueprintService.delete()`.
 *
 * IMPORTANT: any new table with a foreign key into `run` (directly or through
 * stage executions, attempts or artifacts) must be added here, and to the e2e
 * tests that assert the full cascade (see CLAUDE.md).
 */
export async function deleteRunsCascade(
  tx: Tx,
  runIds: string[],
  reason: StorageOrphanReason,
): Promise<{ stageExecutionCount: number; artifactCount: number }> {
  if (runIds.length === 0) return { stageExecutionCount: 0, artifactCount: 0 };
  const stageExecutionIds = (
    await tx
      .select({ id: stageExecution.id })
      .from(stageExecution)
      .where(inArray(stageExecution.runId, runIds))
  ).map((row) => row.id);
  const artifactIds = (
    await tx.select({ id: artifact.id }).from(artifact).where(inArray(artifact.runId, runIds))
  ).map((row) => row.id);

  await tx.delete(stageEvent).where(inArray(stageEvent.runId, runIds));
  await tx.delete(ledgerEntry).where(inArray(ledgerEntry.runId, runIds));
  await tx.delete(humanWait).where(inArray(humanWait.runId, runIds));
  await tx.delete(runWakeup).where(inArray(runWakeup.runId, runIds));
  await tx.delete(notification).where(inArray(notification.runId, runIds));
  await tx.delete(runMemory).where(inArray(runMemory.runId, runIds));
  if (artifactIds.length) {
    await tx.delete(artifactAttachment).where(inArray(artifactAttachment.artifactId, artifactIds));
  }
  if (stageExecutionIds.length) {
    await tx.delete(stageAttempt).where(inArray(stageAttempt.stageExecutionId, stageExecutionIds));
    await tx.delete(stageItem).where(inArray(stageItem.stageExecutionId, stageExecutionIds));
  }
  await tx.delete(stageExecution).where(inArray(stageExecution.runId, runIds));
  await tx.delete(artifact).where(inArray(artifact.runId, runIds));

  const files = await tx
    .delete(blob)
    .where(inArray(blob.runId, runIds))
    .returning({ objectKey: blob.objectKey });
  await queueStorageOrphans(
    tx,
    files.map((file) => file.objectKey),
    reason,
  );
  await tx.delete(run).where(inArray(run.id, runIds));
  return { stageExecutionCount: stageExecutionIds.length, artifactCount: artifactIds.length };
}
