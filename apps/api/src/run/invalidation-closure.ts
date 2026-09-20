import type { RefProvenance } from '../artifact/binding-resolver.service';

export interface ActiveExecutionRead {
  stageKey: string;
  stageExecutionId: string;
  /** Undefined for a non-iterating stage's own (only) node. Set for one of
   * an iterating stage's per-item nodes — phase 7 chunk 5. */
  itemIndex?: number;
  artifactId?: string;
  /** phase 7 chunk 5 — true iff this stage's OWN declared bindings (any
   * slot, context, or check ref) include a `{from:'prevItem'}` anywhere.
   * Computed by the DB-facing caller from the `StageDef`, never derived
   * from `provenance`: an item-0 attempt never actually resolves a value
   * for `prevItem` (no artifactId is recorded), so provenance-only
   * inference would silently under-invalidate item 0's dependents. Only
   * meaningful when `itemIndex` is set. */
  bindsPrevItem?: boolean;
  provenance: Record<string, RefProvenance>;
}

export interface MemoryVersionWriter {
  memoryKey: string;
  memoryVersion: number;
  stageKey: string;
  itemIndex?: number;
}

export interface InvalidationSeed {
  stageKeys?: string[];
  forcedStageKeys?: string[];
  /** phase 7 chunk 5 — item-precise seed: invalidate exactly this
   * `(stageKey, itemIndex)` pair, as opposed to `stageKeys`, which invalidates
   * every item of an iterating stage. Not yet produced by any caller (that's
   * chunk 6's job) — the algorithm supports it starting now. */
  items?: Array<{ stageKey: string; itemIndex: number }>;
  artifactIds?: string[];
  inputKeys?: string[];
}

/** phase 7 chunk 5 — one entry per invalid `(stageKey, itemIndex | whole
 * stage)` node, in graph order then ascending item order. This is the
 * item-precise information `InvalidationService.apply()` needs to stale
 * `stage_item` rows and tombstone memory per index; `affectedStageKeys` /
 * `affectedExecutionIds` / `affectedArtifactIds` stay at the granularity
 * they always operated at (one entry per affected stage) for backward
 * compatibility with existing callers. */
export interface AffectedItem {
  stageKey: string;
  stageExecutionId: string;
  itemIndex?: number;
  artifactId?: string;
}

export interface InvalidationClosure {
  /** One entry per affected stage (deduplicated), in graph order —
   * unchanged semantics from before phase 7 chunk 5, including when a
   * stage's OWN items are only partially affected. */
  affectedStageKeys: string[];
  /** One `stageExecutionId` per entry of `affectedStageKeys`, same order —
   * unchanged. */
  affectedExecutionIds: string[];
  /** The union of every invalid node's own artifact (item-level and
   * stage-level), in graph/item order, plus any artifact ids seeded
   * without a corresponding node (e.g. `$input:<key>`). This is now a
   * superset of "one per stage" when an iterating stage has more than one
   * invalid item. */
  affectedArtifactIds: string[];
  /** phase 7 chunk 5 — item-precise closure output. */
  affectedItems: AffectedItem[];
}

/**
 * §15.2 — computes the dependency closure from the reads recorded by active
 * attempts. This is deliberately pure: the DB-facing service is responsible
 * for loading active attempts and memory-version writers, while this function
 * owns the easily unit-tested graph semantics.
 *
 * phase 7 chunk 5 — the model is one node per `(stageKey, itemIndex |
 * undefined)`. A non-iterating stage is represented by exactly one node
 * (`itemIndex` undefined) — every existing stage-level test keeps its exact
 * prior behavior because that degenerates precisely to "no itemIndex
 * anywhere in the graph". An iterating stage is represented by N item
 * nodes (one per `stage_item`), never a combined "stage + items" pair — the
 * caller (`InvalidationService.preview()`) builds either shape depending on
 * whether the stage has `stage_item` rows.
 */
export function computeInvalidationClosure(params: {
  graphOrder: string[];
  executions: ActiveExecutionRead[];
  seed: InvalidationSeed;
  memoryVersionWriters: MemoryVersionWriter[];
}): InvalidationClosure {
  const nodesByStage = new Map<string, ActiveExecutionRead[]>();
  const nodeByKey = new Map<string, ActiveExecutionRead>();
  for (const node of params.executions) {
    const key = nodeKey(node.stageKey, node.itemIndex);
    nodeByKey.set(key, node);
    const list = nodesByStage.get(node.stageKey);
    if (list) list.push(node);
    else nodesByStage.set(node.stageKey, [node]);
  }
  // Ascending item order within each stage — required so the same-stage
  // `bindsPrevItem` cascade and the output ordering are both deterministic.
  for (const list of nodesByStage.values()) {
    list.sort((a, b) => (a.itemIndex ?? -1) - (b.itemIndex ?? -1));
  }

  const writerByVersion = new Map(
    params.memoryVersionWriters.map((writer) => [
      memoryVersionKey(writer.memoryKey, writer.memoryVersion),
      writer,
    ]),
  );

  const invalidKeys = new Set<string>();
  const affectedArtifacts = new Set<string>(params.seed.artifactIds ?? []);
  const affectedInputs = new Set(params.seed.inputKeys ?? []);

  // Marks one node invalid, cascading same-stage propagation (§15.2 rule):
  // when item i of a `bindsPrevItem` stage goes invalid, items i+1..N-1 of
  // the SAME stage go invalid too — a direct index-range add, since it's
  // the same stage's own item chain, not a graph walk.
  function markInvalid(node: ActiveExecutionRead): void {
    const key = nodeKey(node.stageKey, node.itemIndex);
    if (invalidKeys.has(key)) return;
    invalidKeys.add(key);
    if (node.artifactId) affectedArtifacts.add(node.artifactId);
    if (node.itemIndex !== undefined && node.bindsPrevItem) {
      for (const sibling of nodesByStage.get(node.stageKey) ?? []) {
        if (sibling.itemIndex !== undefined && sibling.itemIndex > node.itemIndex) {
          markInvalid(sibling);
        }
      }
    }
  }

  // Retrying a whole iterating stage invalidates all its items (locked by
  // spec); for a non-iterating stage this is exactly its one node.
  function markWholeStage(stageKey: string): void {
    for (const node of nodesByStage.get(stageKey) ?? []) markInvalid(node);
  }

  for (const stageKey of [
    ...(params.seed.stageKeys ?? []),
    ...(params.seed.forcedStageKeys ?? []),
  ]) {
    markWholeStage(stageKey);
  }
  for (const item of params.seed.items ?? []) {
    const node = nodeByKey.get(nodeKey(item.stageKey, item.itemIndex));
    if (node) markInvalid(node);
  }

  // Graph order is execution order, and every legal dependency points
  // backward. One ordered pass over each stage's node group (itself in
  // ascending item order) therefore computes the transitive closure:
  // adding a node also adds its artifact before any later reader is
  // visited, including a later item of the same stage.
  for (const stageKey of params.graphOrder) {
    for (const node of nodesByStage.get(stageKey) ?? []) {
      const key = nodeKey(node.stageKey, node.itemIndex);
      if (invalidKeys.has(key)) continue;

      let dependsOnAffected = false;
      let wholeStageBecauseGroupRead = false;

      for (const read of Object.values(node.provenance)) {
        if (read.artifactId && affectedArtifacts.has(read.artifactId)) {
          dependsOnAffected = true;
          break;
        }
        if (read.inputKey && affectedInputs.has(read.inputKey)) {
          dependsOnAffected = true;
          break;
        }
        // §15.2 — a bare group-key read (Chunk 2's `memoryVersions` array,
        // one entry per index actually read) invalidates the READING
        // stage as a WHOLE (every one of its own items, if it iterates)
        // when ANY entry was written by a now-invalid `(stageKey,
        // itemIndex)` pair. An explicit `key#i` single-index read
        // (`memoryKey`/`memoryVersion` below) only ever invalidates the
        // one reading node.
        if (read.memoryVersions && read.memoryKey !== undefined) {
          const memoryKey = read.memoryKey;
          const anyInvalid = read.memoryVersions.some((entry) => {
            const writer = writerByVersion.get(
              memoryVersionKey(`${memoryKey}#${entry.itemIndex}`, entry.version),
            );
            return (
              writer !== undefined && invalidKeys.has(nodeKey(writer.stageKey, writer.itemIndex))
            );
          });
          if (anyInvalid) {
            dependsOnAffected = true;
            wholeStageBecauseGroupRead = true;
            break;
          }
          continue;
        }
        if (read.memoryKey !== undefined && read.memoryVersion !== undefined) {
          const writer = writerByVersion.get(memoryVersionKey(read.memoryKey, read.memoryVersion));
          if (writer !== undefined && invalidKeys.has(nodeKey(writer.stageKey, writer.itemIndex))) {
            dependsOnAffected = true;
            break;
          }
        }
      }

      if (!dependsOnAffected) continue;
      if (wholeStageBecauseGroupRead) markWholeStage(stageKey);
      else markInvalid(node);
    }
  }

  const affectedStageKeySet = new Set(
    params.executions
      .filter((node) => invalidKeys.has(nodeKey(node.stageKey, node.itemIndex)))
      .map((node) => node.stageKey),
  );
  const orderedStageKeys = params.graphOrder.filter((stageKey) =>
    affectedStageKeySet.has(stageKey),
  );
  const orderedExecutions = orderedStageKeys
    .map((stageKey) => nodesByStage.get(stageKey)?.[0]?.stageExecutionId)
    .filter((id): id is string => id !== undefined);

  const affectedItems: AffectedItem[] = [];
  for (const stageKey of orderedStageKeys) {
    for (const node of nodesByStage.get(stageKey) ?? []) {
      if (!invalidKeys.has(nodeKey(node.stageKey, node.itemIndex))) continue;
      affectedItems.push({
        stageKey: node.stageKey,
        stageExecutionId: node.stageExecutionId,
        ...(node.itemIndex !== undefined ? { itemIndex: node.itemIndex } : {}),
        ...(node.artifactId ? { artifactId: node.artifactId } : {}),
      });
    }
  }

  // Dedup while preserving order: every invalid node's own artifact first
  // (graph/item order), then any artifact seeded without a corresponding
  // node (notably `$input:<key>`, which has no execution at all).
  const orderedArtifacts: string[] = [];
  const seenArtifacts = new Set<string>();
  for (const item of affectedItems) {
    if (!item.artifactId || seenArtifacts.has(item.artifactId)) continue;
    seenArtifacts.add(item.artifactId);
    orderedArtifacts.push(item.artifactId);
  }
  for (const artifactId of affectedArtifacts) {
    if (seenArtifacts.has(artifactId)) continue;
    seenArtifacts.add(artifactId);
    orderedArtifacts.push(artifactId);
  }

  return {
    affectedStageKeys: orderedStageKeys,
    affectedExecutionIds: orderedExecutions,
    affectedArtifactIds: orderedArtifacts,
    affectedItems,
  };
}

function nodeKey(stageKey: string, itemIndex: number | undefined): string {
  return `${stageKey} ${itemIndex ?? ''}`;
}

function memoryVersionKey(memoryKey: string, memoryVersion: number): string {
  return `${memoryKey} ${memoryVersion}`;
}
