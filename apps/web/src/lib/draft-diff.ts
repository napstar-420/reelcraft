import type { CreateBlueprintVersionDto } from '@reelcraft/shared';
import { stableStringify } from './stable-stringify';

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

const same = (a: unknown, b: unknown) => stableStringify(a ?? null) === stableStringify(b ?? null);

/** What `next` changes compared with `base` (a null base counts as an empty blueprint), by stage key. */
export function diffDrafts(base: DraftLike | null, next: DraftLike): DraftDiff {
  const baseStages = new Map((base?.graph ?? []).map((stage) => [stage.key, stage]));
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
  for (const stage of base?.graph ?? []) {
    if (!nextStages.has(stage.key)) {
      stages.push({ key: stage.key, label: stage.label, kind: 'removed', fields: [] });
    }
  }

  const commonBefore = (base?.graph ?? []).map((s) => s.key).filter((k) => nextStages.has(k));
  const commonAfter = next.graph.map((s) => s.key).filter((k) => baseStages.has(k));
  return {
    stages,
    reordered: commonBefore.join('\u0000') !== commonAfter.join('\u0000'),
    inputs: !same(base?.inputs ?? [], next.inputs),
    roles: !same(base?.roles ?? [], next.roles),
    defaults: !same(base?.defaults ?? {}, next.defaults),
    budget: !same(base?.budget, next.budget),
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

/** A one-line summary: "2 stages added, 1 removed, 3 changed · inputs, budget". */
export function summarizeDiff(diff: DraftDiff): string {
  const count = (kind: StageChange['kind']) => diff.stages.filter((s) => s.kind === kind).length;
  const parts: string[] = [];
  const added = count('added');
  const removed = count('removed');
  const changed = count('changed');
  if (added) parts.push(`${added} ${added === 1 ? 'stage' : 'stages'} added`);
  if (removed) parts.push(`${removed} removed`);
  if (changed) parts.push(`${changed} changed`);
  if (diff.reordered) parts.push('reordered');
  const other = [
    diff.inputs && 'inputs',
    diff.roles && 'role',
    diff.defaults && 'defaults',
    diff.budget && 'budget',
  ].filter(Boolean);
  const text = parts.join(', ');
  if (!other.length) return text || 'No changes';
  return text ? `${text} · ${other.join(', ')}` : `${other.join(', ')} changed`;
}
