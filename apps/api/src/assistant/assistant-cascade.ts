import { inArray } from 'drizzle-orm';
import type { Tx } from '../db/drizzle.provider';
import { assistantItem, assistantSession } from '../db/schema/index';

/** Deletes the assistant chats (and their items) of the given blueprints. Shared by blueprint and
 * channel delete, like `deleteRunsCascade`. Chats hold no files, so nothing goes to the storage
 * sweep. Call it before deleting the blueprints. */
export async function deleteAssistantCascade(tx: Tx, blueprintIds: string[]): Promise<void> {
  if (blueprintIds.length === 0) return;
  const sessionIds = tx
    .select({ id: assistantSession.id })
    .from(assistantSession)
    .where(inArray(assistantSession.blueprintId, blueprintIds));
  await tx.delete(assistantItem).where(inArray(assistantItem.sessionId, sessionIds));
  await tx.delete(assistantSession).where(inArray(assistantSession.blueprintId, blueprintIds));
}
