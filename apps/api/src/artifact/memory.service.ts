import { Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { StageDef } from '@reefcraft/shared';
import type { Tx } from '../db/drizzle.provider';
import { runMemory } from '../db/schema/index';
import { ulid } from '../common/ulid';

export interface MemoryWriteSource {
  runId: string;
  stageKey: string;
  itemIndex?: number;
  kind: string;
  /** The finalized artifact's `data` — the value `StageDef.writes` paths
   * resolve against. `'$'` means "the whole value". */
  data: unknown;
}

/**
 * §3.11/§6.3 — append-only: the current value of a key is its highest
 * non-tombstoned version. No tombstones/invalidation (phase 4) and no
 * indexed-group (`key#i`) writes (phase 7) yet — every write today targets
 * the bare `memKey` named in `StageDef.writes`.
 */
@Injectable()
export class MemoryService {
  /**
   * Returns a callback to pass as `ArtifactService.finalize()`'s
   * `applyWrites` — it must run inside that same transaction (§6.3), so it
   * takes the `tx` handle finalize() owns rather than opening its own.
   * A stage with no `writes` returns a no-op callback.
   */
  buildWriteCallback(stage: StageDef, source: MemoryWriteSource): (tx: Tx) => Promise<void> {
    return async (tx: Tx): Promise<void> => {
      if (!stage.writes) return;
      for (const [memKey, path] of Object.entries(stage.writes)) {
        const value = path === '$' ? source.data : getPath(source.data, path);
        const version = await nextVersion(tx, source.runId, memKey);
        await tx.insert(runMemory).values({
          id: ulid(),
          runId: source.runId,
          memKey,
          version,
          writtenBy: stage.key,
          writtenItem: source.itemIndex,
          kind: source.kind,
          data: value,
        });
      }
    };
  }
}

async function nextVersion(tx: Tx, runId: string, memKey: string): Promise<number> {
  const [row] = await tx
    .select({ version: runMemory.version })
    .from(runMemory)
    .where(and(eq(runMemory.runId, runId), eq(runMemory.memKey, memKey)))
    .orderBy(desc(runMemory.version))
    .limit(1);
  return (row?.version ?? 0) + 1;
}

function getPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, value);
}
