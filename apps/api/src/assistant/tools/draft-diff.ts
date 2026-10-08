import type { CreateBlueprintVersionDto } from '@reelcraft/shared';

type DraftLike = Pick<
  CreateBlueprintVersionDto,
  'graph' | 'inputs' | 'roles' | 'defaults' | 'budget'
>;

export interface StageChange {
  key: string;
  label: string;
  kind: 'added' | 'removed' | 'changed';
  /** The stage fields that differ (for `changed`). */
  fields: string[];
}

export interface DraftDiff {
  stages: StageChange[];
  /** The stages both drafts have appear in a different order. */
  reordered: boolean;
  inputs: boolean;
  roles: boolean;
  defaults: boolean;
  budget: boolean;
}

/** JSON with sorted object keys, so equal values compare equal whatever their key order. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const same = (a: unknown, b: unknown) => stable(a ?? null) === stable(b ?? null);

/** What `next` changes compared with `base`, by stage key. Same rules as the canvas's proposal
 * card (`apps/web/src/lib/draft-diff.ts`), so the assistant and the user see the same diff. */
export function diffDrafts(base: DraftLike, next: DraftLike): DraftDiff {
  const baseStages = new Map(base.graph.map((stage) => [stage.key, stage]));
  const nextStages = new Map(next.graph.map((stage) => [stage.key, stage]));
  const stages: StageChange[] = [];

  for (const stage of next.graph) {
    const before = baseStages.get(stage.key);
    if (!before) {
      stages.push({ key: stage.key, label: stage.label, kind: 'added', fields: [] });
      continue;
    }
    const keys = new Set([...Object.keys(before), ...Object.keys(stage)]);
    const fields = [...keys].filter(
      (field) =>
        !same(
          (before as Record<string, unknown>)[field],
          (stage as Record<string, unknown>)[field],
        ),
    );
    if (fields.length) stages.push({ key: stage.key, label: stage.label, kind: 'changed', fields });
  }
  for (const stage of base.graph) {
    if (!nextStages.has(stage.key)) {
      stages.push({ key: stage.key, label: stage.label, kind: 'removed', fields: [] });
    }
  }

  const commonBefore = base.graph.map((s) => s.key).filter((k) => nextStages.has(k));
  const commonAfter = next.graph.map((s) => s.key).filter((k) => baseStages.has(k));
  return {
    stages,
    reordered: commonBefore.join('\u0000') !== commonAfter.join('\u0000'),
    inputs: !same(base.inputs, next.inputs),
    roles: !same(base.roles, next.roles),
    defaults: !same(base.defaults, next.defaults),
    budget: !same(base.budget, next.budget),
  };
}

export function isEmptyDiff(diff: DraftDiff): boolean {
  return (
    diff.stages.length === 0 &&
    !diff.reordered &&
    !diff.inputs &&
    !diff.roles &&
    !diff.defaults &&
    !diff.budget
  );
}

/** True when the two drafts have the same content. */
export const sameDraft = (a: DraftLike, b: DraftLike) => isEmptyDiff(diffDrafts(a, b));
