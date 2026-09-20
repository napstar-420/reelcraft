import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { ArtifactKind, StageDef } from '@reefcraft/shared';
import type { Db, Tx } from '../db/drizzle.provider';
import { runMemory } from '../db/schema/index';
import { ulid } from '../common/ulid';
import { getPath } from '../common/path';

export interface MemoryWriteSource {
  runId: string;
  stageKey: string;
  itemIndex?: number;
  kind: ArtifactKind;
  /** The finalized artifact's `data` — the value `StageDef.writes` paths
   * resolve against. `'$'` means "the whole value". */
  data: unknown;
  artifactId?: string;
}

export interface InvalidatedMemoryWriter {
  stageKey: string;
  itemIndex?: number;
}

type MemoryExecutor = Db | Tx;
type MemoryRow = typeof runMemory.$inferSelect;

/**
 * §3.11/§6.3 — append-only: the highest version determines the current
 * state. A highest-version tombstone makes the key absent; older values stay
 * available only through history. An iterating stage's `StageDef.writes`
 * target an indexed group (`key#i`) rather than the bare `memKey` (§14);
 * `listGroupCurrent` aggregates a group back into an ordered array.
 */
@Injectable()
export class MemoryService {
  /**
   * Returns the latest visible row per key. Visibility is determined only
   * after selecting the highest version: when that row is a tombstone the
   * key is absent, even if an older value row still exists in history.
   */
  async listCurrent(executor: MemoryExecutor, runId: string): Promise<MemoryRow[]> {
    const latest = await this.listLatest(executor, runId);
    return latest.filter((row) => !row.tombstone);
  }

  /** Complete append-only history, grouped deterministically by key. */
  async listHistory(executor: MemoryExecutor, runId: string): Promise<MemoryRow[]> {
    return executor
      .select()
      .from(runMemory)
      .where(eq(runMemory.runId, runId))
      .orderBy(asc(runMemory.memKey), desc(runMemory.version));
  }

  /**
   * Appends one tombstone for each current value written by an invalidated
   * stage/item. Callers supply their transaction so artifact staleness,
   * execution state, and memory invalidation can commit atomically.
   * Reapplying an invalidation is idempotent because a latest tombstone is
   * never itself eligible for another tombstone.
   */
  async appendTombstones(
    tx: Tx,
    runId: string,
    invalidatedWriters: readonly InvalidatedMemoryWriter[],
  ): Promise<number> {
    if (invalidatedWriters.length === 0) return 0;

    const current = (await this.listLatest(tx, runId)).filter((row) => !row.tombstone);
    let appended = 0;
    for (const row of current) {
      const invalidated = invalidatedWriters.some(
        (writer) =>
          writer.stageKey === row.writtenBy &&
          (writer.itemIndex === undefined
            ? row.writtenItem === null
            : row.writtenItem === writer.itemIndex),
      );
      if (!invalidated) continue;

      // The run lock makes this uncontended in sanctioned call paths. The
      // savepoint/re-read loop is defensive: an accidental caller outside
      // that boundary still cannot resurrect or overwrite a version.
      for (let retry = 0; retry < 3; retry += 1) {
        const [latest] = await tx
          .select()
          .from(runMemory)
          .where(and(eq(runMemory.runId, runId), eq(runMemory.memKey, row.memKey)))
          .orderBy(desc(runMemory.version))
          .limit(1);
        if (!latest || latest.tombstone) break;
        try {
          await tx.transaction((savepoint) =>
            savepoint.insert(runMemory).values({
              id: ulid(),
              runId,
              memKey: latest.memKey,
              version: latest.version + 1,
              writtenBy: latest.writtenBy,
              writtenItem: latest.writtenItem,
              kind: latest.kind,
              schemaHash: latest.schemaHash,
              tombstone: true,
            }),
          );
          appended += 1;
          break;
        } catch (error) {
          if (!isUniqueViolation(error) || retry === 2) throw error;
        }
      }
    }
    return appended;
  }

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
        if (source.kind.startsWith('media.') && path !== '$') {
          throw new Error(
            `MemoryService: media write "${memKey}" must use the whole artifact path "$"`,
          );
        }
        // A `writes` path that doesn't resolve is a blueprint authoring bug
        // (schema/path mismatch), not a legitimate "no value" — writing
        // `undefined` here would silently persist a permanent, versioned
        // memory row every later stage reads as if it were real data.
        if (value === undefined) {
          throw new Error(
            `MemoryService: stage "${stage.key}" writes["${memKey}"] path "${path}" ` +
              `did not resolve against the finalized artifact's data`,
          );
        }
        // §14/§6.3 — an iterating stage's write targets an indexed slot of
        // the group (`key#i`), not the bare key; `writtenItem` still records
        // the bare index (unchanged) so `appendTombstones` keeps matching on
        // it regardless of which key column actually got the row.
        const writtenKey =
          source.itemIndex === undefined ? memKey : `${memKey}#${source.itemIndex}`;
        const version = await nextVersion(tx, source.runId, writtenKey);
        await tx.insert(runMemory).values({
          id: ulid(),
          runId: source.runId,
          memKey: writtenKey,
          version,
          writtenBy: stage.key,
          writtenItem: source.itemIndex,
          kind: source.kind,
          ...(source.kind.startsWith('media.')
            ? { artifactId: source.artifactId }
            : { data: value }),
        });
      }
    };
  }

  /**
   * §6.3/§14 — every current (non-tombstoned) row of an indexed group
   * `baseKey#0…baseKey#N-1`, ordered by the numeric suffix. Used by
   * `{from:'memory', key}` (bare) to aggregate an iterating stage's writes
   * into the ordered array the binding resolver returns. A read that
   * resolves to zero rows (every index tombstoned, or the key was never
   * written) throws — per §6.3, "a read resolving to nothing but tombstones
   * is a runtime error," not an empty array.
   */
  async listGroupCurrent(
    executor: MemoryExecutor,
    runId: string,
    baseKey: string,
  ): Promise<MemoryRow[]> {
    const current = await this.listCurrent(executor, runId);
    const prefix = `${baseKey}#`;
    const indexed = current
      .map((row) => {
        if (!row.memKey.startsWith(prefix)) return undefined;
        const suffix = row.memKey.slice(prefix.length);
        if (!/^\d+$/.test(suffix)) return undefined;
        return { row, index: Number(suffix) };
      })
      .filter((entry): entry is { row: MemoryRow; index: number } => entry !== undefined)
      .sort((a, b) => a.index - b.index);
    if (indexed.length === 0) {
      throw new Error(
        `MemoryService: memory group "${baseKey}" resolved to zero current rows ` +
          '(never written, or every index tombstoned)',
      );
    }
    return indexed.map((entry) => entry.row);
  }

  private async listLatest(executor: MemoryExecutor, runId: string): Promise<MemoryRow[]> {
    const history = await this.listHistory(executor, runId);
    const seen = new Set<string>();
    const latest: MemoryRow[] = [];
    for (const row of history) {
      if (seen.has(row.memKey)) continue;
      seen.add(row.memKey);
      latest.push(row);
    }
    return latest;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
  );
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
