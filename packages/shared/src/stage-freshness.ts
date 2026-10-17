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

function generationDefinition(stage: StageDef) {
  return {
    ...stage,
    label: undefined,
    qc: undefined,
    checks: undefined,
    checkMaxAttempts: undefined,
  };
}

/** Freshness is relative to a workspace definition, not a destructive change to history. */
export function stageFreshness(
  source: CreateBlueprintVersionDto,
  draft: CreateBlueprintVersionDto,
) {
  const oldDeps = stageDependencies(source.graph);
  const newDeps = stageDependencies(draft.graph);
  const globalChange = ['inputs', 'roles', 'defaults'].some(
    (key) =>
      definitionKey(source[key as 'inputs' | 'roles' | 'defaults']) !==
      definitionKey(draft[key as 'inputs' | 'roles' | 'defaults']),
  );
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
      definitionKey(generationDefinition(before)) !== definitionKey(generationDefinition(after)) ||
      definitionKey(oldDeps.get(key)) !== definitionKey(newDeps.get(key))
    ) {
      changed.push(key);
    } else if (
      definitionKey({
        qc: before.qc,
        checks: before.checks,
        checkMaxAttempts: before.checkMaxAttempts,
      }) !==
      definitionKey({
        qc: after.qc,
        checks: after.checks,
        checkMaxAttempts: after.checkMaxAttempts,
      })
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
