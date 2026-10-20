import { and, eq, inArray } from 'drizzle-orm';
import {
  LIBRARY_KINDS,
  ancestorsOf,
  memoryWritersBefore,
  stageDependencies,
  stageRefLeaves,
  type ConfigLayer,
  type RoleDef,
  type SeedStop,
  type SeedStopReason,
  type StageDef,
  type LibraryKind,
} from '@reelcraft/shared';
import { canonicalJson } from '../json-schema/schema-hash';
import { mergeLayer } from '../run-config/layer-merge';
import { collectAssetIds, collectLibraryRefs } from '../blueprint/collect-asset-refs';
import { ASSET_KIND_FOR_LIBRARY } from '../library/library-catalog';
import { ulid } from '../common/ulid';
import type { Tx } from '../db/drizzle.provider';
import {
  artifact,
  artifactAttachment,
  runMemory,
  stageAttempt,
  stageEvent,
  stageExecution,
  stageItem,
} from '../db/schema/index';
import type { RefProvenance } from '../artifact/binding-resolver.service';

/** A stage_execution row shaped just enough for `reusableStageKeys` — callers
 * pass the source run's rows, already keyed by `stageKey`. */
export interface SourceExecutionSummary {
  stageKey: string;
  state: string;
  needsItemWork: boolean;
  /** An item-mode approval wait leaves the execution `running` and only the
   * item `awaiting_approval`. */
  itemAwaitingApproval?: boolean;
}

export interface ReusableStageKeysParams {
  sourceGraph: StageDef[];
  newGraph: StageDef[];
  sourceResolvedConfig: Record<string, ConfigLayer>;
  sourceOverrides: Record<string, ConfigLayer>;
  newResolvedConfig: Record<string, ConfigLayer>;
  sourceAssetBindings: Record<string, { blobId: string; kind: string }>;
  newAssetBindings: Record<string, { blobId: string; kind: string }>;
  sourceRoles: RoleDef[];
  newRoles: RoleDef[];
  sourceExecutions: SourceExecutionSummary[];
  /** Force these keys and stages that depend on them to re-run. */
  rerunStageKeys: string[];
  /** Finished stages kept as they are even though their definition, settings or
   * assets changed (the person chose to continue after them). They still have to
   * be passed, in place, and have every dependency reused. */
  keepStageKeys?: string[];
  /** Limits this pass to selected stages; callers can assess the requested
   * path separately from already-finished sibling branches. */
  relevant?: Set<string>;
}

/** `iterate.concurrency` and `dependsOn` only change when and how fast a
 * stage runs, not what it produces, so a change to either must not break
 * reuse. */
function comparableStage(stage: StageDef): unknown {
  const rest: StageDef = { ...stage };
  delete rest.dependsOn;
  delete rest.disabled;
  if (!rest.iterate || !('concurrency' in rest.iterate)) return rest;
  const iterate: Record<string, unknown> = { ...rest.iterate };
  delete iterate.concurrency;
  return { ...rest, iterate };
}

function sourceStopReason(e: SourceExecutionSummary): SeedStopReason {
  if (e.state === 'awaiting_approval' || e.itemAwaitingApproval) return 'awaiting_approval';
  if (e.state === 'awaiting_input') return 'awaiting_input';
  if (e.state === 'failed') return 'failed';
  if (e.state === 'cancelled') return 'cancelled';
  return e.needsItemWork ? 'items_incomplete' : 'not_run';
}

const SEED_STOP_CLAUSES: Record<SeedStopReason, string> = {
  roles_changed: 'the blueprint roles changed since the source run',
  definition_changed: 'its definition changed since the source run',
  config_changed: 'its settings changed since the source run',
  assets_changed: 'an asset it uses changed since the source run',
  not_in_source: 'it is not in the source run',
  awaiting_approval: 'it was awaiting approval in the source run',
  awaiting_input: 'it was awaiting input in the source run',
  failed: 'it failed in the source run',
  cancelled: 'it was cancelled in the source run',
  not_run: 'it had not finished running in the source run',
  items_incomplete: 'some of its items had not finished in the source run',
  rerun_requested: 'it was requested to run again',
};

/** Why a seeded run re-runs `stop.stageKey`, as a sentence. */
export function describeSeedStop(stop: SeedStop, lead = 'Re-running'): string {
  return `${lead} "${stop.stageKey}": ${SEED_STOP_CLAUSES[stop.reason]}`;
}

/** Reuse each unchanged, passed stage whose own dependencies were also reused.
 * `stop` records the first stage that needs work in the requested scope. */
export function reusableStageKeys(p: ReusableStageKeysParams): {
  keys: string[];
  stop?: SeedStop;
} {
  const first = p.newGraph[0];
  if (first && canonicalJson(p.sourceRoles) !== canonicalJson(p.newRoles)) {
    return { keys: [], stop: { stageKey: first.key, reason: 'roles_changed' } };
  }

  const sourceByKey = new Map(p.sourceExecutions.map((e) => [e.stageKey, e]));
  const sourceIndexByKey = new Map(p.sourceGraph.map((stage, index) => [stage.key, index]));
  const rerunSet = new Set(p.rerunStageKeys);
  const keepSet = new Set(p.keepStageKeys ?? []);
  const deps = stageDependencies(p.newGraph);
  const keys: string[] = [];
  const reusable = new Set<string>();
  let stop: SeedStop | undefined;

  for (let i = 0; i < p.newGraph.length; i++) {
    const newStage = p.newGraph[i]!;
    if (p.relevant && !p.relevant.has(newStage.key)) continue;
    const sourceIndex = sourceIndexByKey.get(newStage.key);
    const sourceStage = sourceIndex === undefined ? undefined : p.sourceGraph[sourceIndex];
    const sourceExecution = sourceByKey.get(newStage.key);
    const stopAt = (reason: SeedStopReason) => {
      stop ??= { stageKey: newStage.key, reason };
    };

    if (sourceIndex === undefined || !sourceStage || !sourceExecution) {
      stopAt('not_in_source');
      continue;
    }
    if (
      sourceIndex !== i &&
      (sourceStage.dependsOn === undefined || newStage.dependsOn === undefined)
    ) {
      stopAt('not_in_source');
      continue;
    }
    const sameReadSources = stageRefLeaves(newStage).every((ref) => {
      if (ref.from === 'prev') {
        return p.sourceGraph[sourceIndex - 1]?.key === p.newGraph[i - 1]?.key;
      }
      if (ref.from === 'memory') {
        return (
          canonicalJson(memoryWritersBefore(p.sourceGraph, ref.key, sourceIndex)) ===
          canonicalJson(memoryWritersBefore(p.newGraph, ref.key, i))
        );
      }
      return true;
    });
    const kept = keepSet.has(newStage.key);
    if (!sameReadSources && !kept) {
      stopAt('definition_changed');
      continue;
    }
    if (rerunSet.has(newStage.key)) {
      stopAt('rerun_requested');
      continue;
    }
    if (!(deps.get(newStage.key) ?? []).every((key) => reusable.has(key))) {
      stopAt('not_run');
      continue;
    }
    if (
      !kept &&
      canonicalJson(comparableStage(sourceStage)) !== canonicalJson(comparableStage(newStage))
    ) {
      stopAt('definition_changed');
      continue;
    }

    const sourceLayer = mergeLayer(
      p.sourceResolvedConfig[newStage.key] ?? {},
      p.sourceOverrides[newStage.key] ?? {},
    );
    if (
      !kept &&
      canonicalJson(sourceLayer) !== canonicalJson(p.newResolvedConfig[newStage.key] ?? {})
    ) {
      stopAt('config_changed');
      continue;
    }

    const assetIds = collectAssetIds([newStage]);
    const bindingsMatch = assetIds.every(
      (id) => canonicalJson(p.sourceAssetBindings[id]) === canonicalJson(p.newAssetBindings[id]),
    );
    // A stage that lists the library also depends on which assets the library held.
    const libraryMatch = collectLibraryRefs([newStage]).every(
      (ref) =>
        canonicalJson(libraryView(p.sourceAssetBindings, ref.kinds)) ===
        canonicalJson(libraryView(p.newAssetBindings, ref.kinds)),
    );
    if ((!bindingsMatch || !libraryMatch) && !kept) {
      stopAt('assets_changed');
      continue;
    }

    if (sourceExecution.state !== 'passed' || sourceExecution.needsItemWork) {
      stopAt(sourceStopReason(sourceExecution));
      continue;
    }

    keys.push(newStage.key);
    reusable.add(newStage.key);
  }

  return { keys, ...(stop && { stop }) };
}

/** Deep-remaps every `artifactId`/`artifactIds` inside a `resolvedInputs`
 * blob from the source run's artifact ids to the new run's copies, so
 * `InvalidationService`'s provenance walk (`invalidation.service.ts:119`)
 * sees the copy, not a dangling reference into another run. Unknown ids pass
 * through unchanged rather than throwing, since `resolvedInputs` also carries
 * non-artifact provenance (memory/input/asset refs) that must be left alone. */
export function remapProvenance(
  provenance: Record<string, RefProvenance>,
  idMap: Map<string, string>,
): Record<string, RefProvenance> {
  const remapped: Record<string, RefProvenance> = {};
  for (const [slot, prov] of Object.entries(provenance)) {
    remapped[slot] = {
      ...prov,
      ...(prov.artifactId && { artifactId: idMap.get(prov.artifactId) ?? prov.artifactId }),
      ...(prov.artifactIds && {
        artifactIds: prov.artifactIds.map((id) => idMap.get(id) ?? id),
      }),
    };
  }
  return remapped;
}

/** A timeline names its media as `artifact:<id>` handles into the run that made
 * it, and the renderer only resolves a run's own artifacts, so a copied
 * timeline must point at the copies. */
export function remapTimelineHandles(data: unknown, idMap: Map<string, string>): unknown {
  if (data === null || data === undefined) return data;
  return JSON.parse(
    JSON.stringify(data).replace(/artifact:([0-9A-Za-z]+)/g, (match, id: string) => {
      const copy = idMap.get(id);
      return copy ? `artifact:${copy}` : match;
    }),
  );
}

export interface CopyReusedStagesParams {
  sourceRunId: string;
  runId: string;
  stageKeys: string[];
  /** stageKey -> new stage_execution id, already inserted by the caller. */
  newExecutionIdByKey: Map<string, string>;
}

/**
 * Copies a source run's finished work for `stageKeys` (plus every `$input`
 * artifact) into a brand-new run, marking it all reused at $0 — see the
 * "seeded run" design in the run-stages-from-canvas plan. Must run inside
 * the same transaction as the new run's `stage_execution` inserts.
 */
export async function copyReusedStages(
  tx: Tx,
  p: CopyReusedStagesParams,
): Promise<{ copiedInputKeys: Set<string> }> {
  const stageKeySet = new Set(p.stageKeys);
  const idMap = new Map<string, string>();

  const sourceArtifacts = await tx
    .select()
    .from(artifact)
    .where(and(eq(artifact.runId, p.sourceRunId), eq(artifact.stale, false)));
  const reusedArtifacts = sourceArtifacts.filter(
    (a) => a.producerStageKey.startsWith('$input:') || stageKeySet.has(a.producerStageKey),
  );
  const copiedInputKeys = new Set(
    reusedArtifacts
      .filter((a) => a.producerStageKey.startsWith('$input:'))
      .map((a) => a.producerStageKey.slice('$input:'.length)),
  );
  if (reusedArtifacts.length === 0) return { copiedInputKeys };

  for (const src of reusedArtifacts) idMap.set(src.id, ulid());
  for (const src of reusedArtifacts) {
    await tx.insert(artifact).values({
      ...src,
      id: idMap.get(src.id)!,
      runId: p.runId,
      stale: false,
      costUsd: '0',
      ...(src.kind === 'timeline' && { data: remapTimelineHandles(src.data, idMap) }),
    });
  }

  const attachments = await tx
    .select()
    .from(artifactAttachment)
    .where(inArray(artifactAttachment.artifactId, [...idMap.keys()]));
  for (const att of attachments) {
    await tx.insert(artifactAttachment).values({
      ...att,
      id: ulid(),
      artifactId: idMap.get(att.artifactId)!,
    });
  }

  const sourceExecutions = await tx
    .select()
    .from(stageExecution)
    .where(
      and(eq(stageExecution.runId, p.sourceRunId), inArray(stageExecution.stageKey, p.stageKeys)),
    );
  const sourceExecutionByKey = new Map(sourceExecutions.map((e) => [e.stageKey, e]));

  for (const stageKey of p.stageKeys) {
    const sourceExecution = sourceExecutionByKey.get(stageKey);
    const newExecutionId = p.newExecutionIdByKey.get(stageKey);
    if (!sourceExecution || !newExecutionId) continue;

    const newOutputArtifactId = sourceExecution.outputArtifactId
      ? idMap.get(sourceExecution.outputArtifactId)
      : undefined;

    await tx
      .update(stageExecution)
      .set({
        state: 'passed',
        isIterating: sourceExecution.isIterating,
        itemCount: sourceExecution.itemCount,
        outputArtifactId: newOutputArtifactId ?? null,
        costUsd: '0',
        generation: sourceExecution.generation,
        startedAt: sourceExecution.startedAt,
        endedAt: sourceExecution.endedAt,
      })
      .where(eq(stageExecution.id, newExecutionId));

    const items = await tx
      .select()
      .from(stageItem)
      .where(eq(stageItem.stageExecutionId, sourceExecution.id));
    const newItemIdByOldId = new Map<string, string>();
    for (const item of items) {
      const newItemId = ulid();
      newItemIdByOldId.set(item.id, newItemId);
      await tx.insert(stageItem).values({
        ...item,
        id: newItemId,
        stageExecutionId: newExecutionId,
        state: 'passed',
        costUsd: '0',
        outputArtifactId: item.outputArtifactId ? (idMap.get(item.outputArtifactId) ?? null) : null,
      });
    }

    await copyActiveAttempts(tx, {
      sourceStageExecutionId: sourceExecution.id,
      newStageExecutionId: newExecutionId,
      items,
      newItemIdByOldId,
      idMap,
    });

    await tx.insert(stageEvent).values({
      id: ulid(),
      runId: p.runId,
      stageExecutionId: newExecutionId,
      level: 'info',
      type: 'stage.reused',
      message: `Reused "${stageKey}" from a previous run`,
      data: { sourceRunId: p.sourceRunId, sourceStageExecutionId: sourceExecution.id },
      createdAt: new Date().toISOString(),
    });
  }

  const memoryRows = await tx
    .select()
    .from(runMemory)
    .where(and(eq(runMemory.runId, p.sourceRunId), inArray(runMemory.writtenBy, p.stageKeys)));
  for (const row of memoryRows) {
    await tx.insert(runMemory).values({
      ...row,
      id: ulid(),
      runId: p.runId,
      artifactId: row.artifactId ? (idMap.get(row.artifactId) ?? row.artifactId) : null,
    });
  }
  return { copiedInputKeys };
}

/** Picks the same "active" attempt `InvalidationService` would
 * (`invalidation.service.ts:119-158`: the attempt whose `artifactId` matches
 * the execution/item's output, falling back to the highest attemptNo), then
 * copies it as a settled success at $0 with `resolvedInputs` remapped onto
 * the new run's artifact ids — this is what lets a LATER retry inside the
 * seeded run correctly invalidate a reused stage. Without this, a reused
 * stage has no attempt row, no provenance, and a retry upstream of it would
 * silently leave it stale-but-marked-passed forever. */
async function copyActiveAttempts(
  tx: Tx,
  p: {
    sourceStageExecutionId: string;
    newStageExecutionId: string;
    items: Array<{ id: string; outputArtifactId: string | null }>;
    newItemIdByOldId: Map<string, string>;
    idMap: Map<string, string>;
  },
): Promise<void> {
  const attempts = await tx
    .select()
    .from(stageAttempt)
    .where(eq(stageAttempt.stageExecutionId, p.sourceStageExecutionId));

  const pickActive = <T extends { artifactId: string | null; attemptNo: number }>(
    candidates: T[],
    outputArtifactId: string | null | undefined,
  ): T | undefined => {
    const active = outputArtifactId
      ? candidates.find((c) => c.artifactId === outputArtifactId)
      : undefined;
    if (active) return active;
    return candidates.reduce<T | undefined>(
      (cur, c) => (!cur || c.attemptNo > cur.attemptNo ? c : cur),
      undefined,
    );
  };

  const copyAttempt = async (
    src: (typeof attempts)[number],
    newStageExecutionId: string,
    newStageItemId: string | null,
    newArtifactId: string | null,
  ) => {
    await tx.insert(stageAttempt).values({
      ...src,
      id: ulid(),
      stageExecutionId: newStageExecutionId,
      stageItemId: newStageItemId,
      outcome: 'success',
      phase: 'settled',
      resolvedInputs: remapProvenance(
        (src.resolvedInputs ?? {}) as Record<string, RefProvenance>,
        p.idMap,
      ),
      idempotencyKey: null,
      jobHandle: null,
      artifactId: newArtifactId,
      costUsd: '0',
    });
  };

  if (p.items.length === 0) {
    const nonItemAttempts = attempts.filter((a) => a.stageItemId === null);
    const [execution] = await tx
      .select({ outputArtifactId: stageExecution.outputArtifactId })
      .from(stageExecution)
      .where(eq(stageExecution.id, p.sourceStageExecutionId));
    const active = pickActive(nonItemAttempts, execution?.outputArtifactId);
    if (active) {
      const newArtifactId = active.artifactId ? (p.idMap.get(active.artifactId) ?? null) : null;
      await copyAttempt(active, p.newStageExecutionId, null, newArtifactId);
    }
    return;
  }

  for (const item of p.items) {
    const itemAttempts = attempts.filter((a) => a.stageItemId === item.id);
    const active = pickActive(itemAttempts, item.outputArtifactId);
    if (!active) continue;
    const newItemId = p.newItemIdByOldId.get(item.id)!;
    const newArtifactId = active.artifactId ? (p.idMap.get(active.artifactId) ?? null) : null;
    await copyAttempt(active, p.newStageExecutionId, newItemId, newArtifactId);
  }
}

/** The stages a run that stops at `untilStageKey` still runs: that stage and
 * everything it waits for, directly or through others. The rest are created
 * `skipped`. Undefined when unset or not found. */
export function untilStageKeep(
  graph: StageDef[],
  untilStageKey: string | undefined,
): Set<string> | undefined {
  if (!untilStageKey || !graph.some((s) => s.key === untilStageKey)) return undefined;
  return new Set([untilStageKey, ...ancestorsOf(stageDependencies(graph), untilStageKey)]);
}

/** The library assets of one kind a run snapshotted, in a stable order. */
function libraryView(
  bindings: Record<string, { blobId: string; kind: string }>,
  kinds: readonly LibraryKind[] | undefined,
): unknown[] {
  const wanted = new Set((kinds ?? LIBRARY_KINDS).map((kind) => ASSET_KIND_FOR_LIBRARY[kind]));
  return Object.entries(bindings)
    .filter(
      ([, binding]) =>
        (binding as { inLibrary?: boolean }).inLibrary === true && wanted.has(binding.kind),
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, binding]) => [id, binding]);
}
