import type { Ref, StageDef, ValidationIssue } from '@reelcraft/shared';
import { deriveMemoryWriters } from '../lib/memory-writers';
import { parseValidationPath } from '../lib/parse-validation-path';

/** Splices `graph[fromIndex]` out and back in at `toIndex`. */
export function moveStage(graph: StageDef[], fromIndex: number, toIndex: number): StageDef[] {
  if (fromIndex === toIndex) return graph;
  const next = [...graph];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return graph;
  next.splice(toIndex, 0, moved);
  return next;
}

/** Inserts `stage` so it ends up at `index` (clamped; past the end appends). */
export function insertStage(graph: StageDef[], stage: StageDef, index: number): StageDef[] {
  const at = Math.min(Math.max(index, 0), graph.length);
  return [...graph.slice(0, at), stage, ...graph.slice(at)];
}

/** Every `{from:'memory'}` key a stage reads — `Ref` appears uniformly in
 * slots/context/iterate.over/script-check refs. */
export function memoryKeysReadByStage(stage: StageDef): string[] {
  const keys = new Set<string>();
  const note = (ref: Ref | undefined) => {
    if (ref?.from === 'memory') keys.add(ref.key);
  };
  for (const ref of Object.values(stage.slots)) note(ref);
  for (const ref of Object.values(stage.context)) note(ref);
  if (stage.iterate) note(stage.iterate.over);
  for (const check of stage.checks) {
    if (check.type === 'script') {
      for (const ref of Object.values(check.refs ?? {})) note(ref);
    }
  }
  return [...keys];
}

export type MemoryLink = {
  key: string;
  from: string;
  to: string;
  /** More than one stage writes this key; it gets one link per writer and is
   * drawn as a warning, mirroring the validator's own multiple-writer check. */
  ambiguous: boolean;
};

/** Writer lookup is derived client-side purely to draw these links; it never
 * decides validity (that stays server-authoritative). */
export function memoryLinks(graph: StageDef[]): MemoryLink[] {
  const writers = deriveMemoryWriters(graph);
  const links: MemoryLink[] = [];
  for (const stage of graph) {
    for (const key of memoryKeysReadByStage(stage)) {
      const writerKeys = writers.get(key) ?? [];
      const ambiguous = writerKeys.length > 1;
      for (const writerKey of writerKeys) {
        if (writerKey === stage.key) continue;
        links.push({ key, from: writerKey, to: stage.key, ambiguous });
      }
    }
  }
  return links;
}

export function groupIssuesByStage(issues: ValidationIssue[]): Map<string, ValidationIssue[]> {
  const byStage = new Map<string, ValidationIssue[]>();
  for (const issue of issues) {
    const { stageKey } = parseValidationPath(issue.path);
    if (!stageKey) continue;
    const list = byStage.get(stageKey);
    if (list) list.push(issue);
    else byStage.set(stageKey, [issue]);
  }
  return byStage;
}

export function graphLevelIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) => !parseValidationPath(issue.path).stageKey);
}

export function issueCounts(issues: ValidationIssue[] | undefined): {
  errors: number;
  warnings: number;
} {
  const errors = issues?.filter((i) => i.severity === 'error').length ?? 0;
  return { errors, warnings: (issues?.length ?? 0) - errors };
}

export type ProblemRow = {
  issue: ValidationIssue;
  stageKey?: string | undefined;
  stageLabel?: string | undefined;
};

/** Every issue as a row: graph-level ones first, then per stage in graph order. */
export function problemRows(graph: StageDef[], issues: ValidationIssue[]): ProblemRow[] {
  const order = new Map(graph.map((stage, index) => [stage.key, index]));
  const rows = issues.map<ProblemRow>((issue) => {
    const { stageKey } = parseValidationPath(issue.path);
    const stage = stageKey ? graph.find((s) => s.key === stageKey) : undefined;
    return { issue, stageKey, stageLabel: stage ? stage.label || stage.key : stageKey };
  });
  const rank = (row: ProblemRow) =>
    row.stageKey === undefined ? -1 : (order.get(row.stageKey) ?? graph.length);
  return rows.sort((a, b) => rank(a) - rank(b));
}
