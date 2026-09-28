import { and, eq, inArray } from 'drizzle-orm';
import type { ConfigLayer, RoleDef, StageDef } from '@reelcraft/shared';
import { canonicalJson } from '../json-schema/schema-hash';
import { mergeLayer } from '../run-config/layer-merge';
import { collectAssetIds } from '../blueprint/collect-asset-refs';
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
  /** Force these keys (and everything from the earliest one on) to re-run. */
  rerunStageKeys: string[];
}

/**
 * The longest PREFIX of `newGraph` that can be copied verbatim from the
 * source run, per the plan's "longest unchanged prefix" rule: stages run
 * strictly in array order and `prev` only ever looks at the immediately
 * preceding stage (`stage-runner.service.ts`'s `prevStageKey`), so once one
 * stage in the prefix differs, every stage from there on must re-run —
 * there's no need for a dependency graph to get this right.
 *
 * ponytail: prefix-only reuse. Inserting a stage in the MIDDLE of an
 * otherwise-unchanged graph re-runs everything after it, even stages that
 * don't actually depend on the insertion. Upgrade path: a per-stage
 * fingerprint built from its transitive `prev`/`memory`/`input` refs instead
 * of "index i matches" — not needed for the common case (append a stage, or
 * edit one stage) this feature targets.
 */
export function reusableStageKeys(p: ReusableStageKeysParams): string[] {
  if (canonicalJson(p.sourceRoles) !== canonicalJson(p.newRoles)) return [];

  const sourceByKey = new Map(p.sourceExecutions.map((e) => [e.stageKey, e]));
  const rerunSet = new Set(p.rerunStageKeys);
  const reused: string[] = [];

  for (let i = 0; i < p.newGraph.length; i++) {
    const newStage = p.newGraph[i]!;
    const sourceStage = p.sourceGraph[i];
    if (!sourceStage || sourceStage.key !== newStage.key) break;
    if (canonicalJson(sourceStage) !== canonicalJson(newStage)) break;

    const sourceLayer = mergeLayer(
      p.sourceResolvedConfig[newStage.key] ?? {},
      p.sourceOverrides[newStage.key] ?? {},
    );
    if (canonicalJson(sourceLayer) !== canonicalJson(p.newResolvedConfig[newStage.key] ?? {}))
      break;

    const assetIds = collectAssetIds([newStage]);
    const bindingsMatch = assetIds.every(
      (id) => canonicalJson(p.sourceAssetBindings[id]) === canonicalJson(p.newAssetBindings[id]),
    );
    if (!bindingsMatch) break;

    const sourceExecution = sourceByKey.get(newStage.key);
    if (!sourceExecution || sourceExecution.state !== 'passed' || sourceExecution.needsItemWork)
      break;

    if (rerunSet.has(newStage.key)) break;

    reused.push(newStage.key);
  }

  return reused;
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
export async function copyReusedStages(tx: Tx, p: CopyReusedStagesParams): Promise<void> {
  const stageKeySet = new Set(p.stageKeys);
  const idMap = new Map<string, string>();

  const sourceArtifacts = await tx
    .select()
    .from(artifact)
    .where(and(eq(artifact.runId, p.sourceRunId), eq(artifact.stale, false)));
  const reusedArtifacts = sourceArtifacts.filter(
    (a) => a.producerStageKey.startsWith('$input:') || stageKeySet.has(a.producerStageKey),
  );
  if (reusedArtifacts.length === 0) return;

  for (const src of reusedArtifacts) {
    const newId = ulid();
    idMap.set(src.id, newId);
    await tx.insert(artifact).values({
      ...src,
      id: newId,
      runId: p.runId,
      stale: false,
      costUsd: '0',
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

/** Returns the graph index just after `untilStageKey`, or `undefined` when
 * unset or not found. Stages at/after that index are created `skipped`. */
export function untilStageIndex(
  graph: StageDef[],
  untilStageKey: string | undefined,
): number | undefined {
  if (!untilStageKey) return undefined;
  const idx = graph.findIndex((s) => s.key === untilStageKey);
  return idx === -1 ? undefined : idx;
}
