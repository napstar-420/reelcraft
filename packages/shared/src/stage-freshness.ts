import type { CreateBlueprintVersionDto } from './dto/blueprint.dto';
import { descendantsOf, stageDependencies } from './stage-deps';
import type { StageDef } from './stage-def';

/** Stable comparison of JSON definitions; object property order is not an edit. */
export function definitionKey(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}

/** The part of a stage that decides what it generates. Labels, availability, checks and QC,
 * the model and how it runs (retries, budget, approval, concurrency) are left out: changing
 * them keeps the stage's output. */
export function generationStage(stage: StageDef) {
  const iterate = stage.iterate && {
    over: stage.iterate.over,
    itemAlias: stage.iterate.itemAlias,
    alignWith: stage.iterate.alignWith,
    maxItems: stage.iterate.maxItems,
  };
  return {
    ...stage,
    label: undefined,
    group: undefined,
    disabled: undefined,
    enabledWhen: undefined,
    qc: undefined,
    checks: undefined,
    checkMaxAttempts: undefined,
    retryLimit: undefined,
    budget: undefined,
    approval: undefined,
    model: undefined,
    iterate,
  };
}

/** What a stage's output is judged by. Max attempts only matter when an output fails. */
export function validationStage(stage: StageDef) {
  return {
    checks: stage.checks,
    qc: stage.qc && { ...stage.qc, maxAttempts: undefined, onExhausted: undefined },
  };
}

/** The blueprint-wide settings that change what every stage generates: input and role
 * definitions (not their labels or whether they're required) and the format. Default
 * models, retries, budget and polling only change how stages run. */
export function blueprintGeneration(dto: CreateBlueprintVersionDto) {
  return {
    inputs: dto.inputs.map((input) => ({ ...input, label: undefined, required: undefined })),
    roles: dto.roles.map((role) => ({ ...role, label: undefined, required: undefined })),
    format: dto.defaults.format,
  };
}

/** Freshness is relative to a workspace definition, not a destructive change to history. */
export function stageFreshness(
  source: CreateBlueprintVersionDto,
  draft: CreateBlueprintVersionDto,
) {
  const oldDeps = stageDependencies(source.graph);
  const newDeps = stageDependencies(draft.graph);
  const globalChange =
    definitionKey(blueprintGeneration(source)) !== definitionKey(blueprintGeneration(draft));
  const maxItemsChange =
    definitionKey(source.defaults.iterate?.maxItems) !==
    definitionKey(draft.defaults.iterate?.maxItems);
  const qcDefaultsChange =
    definitionKey([source.defaults.qc?.threshold, source.defaults.qc?.model]) !==
    definitionKey([draft.defaults.qc?.threshold, draft.defaults.qc?.model]);
  const changed: string[] = [];
  const validation: string[] = [];
  const keys = new Set([...source.graph, ...draft.graph].map((stage) => stage.key));
  for (const key of keys) {
    const before = source.graph.find((stage) => stage.key === key);
    const after = draft.graph.find((stage) => stage.key === key);
    if (
      globalChange ||
      !before ||
      !after ||
      (maxItemsChange && (before.iterate || after.iterate)) ||
      definitionKey(generationStage(before)) !== definitionKey(generationStage(after)) ||
      definitionKey(oldDeps.get(key)) !== definitionKey(newDeps.get(key))
    ) {
      changed.push(key);
    } else if (
      (qcDefaultsChange && (before.qc || after.qc)) ||
      definitionKey(validationStage(before)) !== definitionKey(validationStage(after))
    ) {
      validation.push(key);
    }
  }
  const stale = new Set(changed);
  for (const key of changed) {
    for (const deps of [oldDeps, newDeps])
      for (const child of descendantsOf(deps, key)) stale.add(child);
  }
  return { changedStageKeys: changed, validationStageKeys: validation, staleStageKeys: [...stale] };
}
