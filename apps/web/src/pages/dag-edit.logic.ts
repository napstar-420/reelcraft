import type { Ref, StageDef } from '@reelcraft/shared';
import { stageDependencies } from '@/lib/stage-deps';

/** Freeze positional semantics before an edge edit can change array order. */
export function explicitGraph(graph: StageDef[]): StageDef[] {
  return graph.map((stage, index) => {
    const visit = (ref: Ref): Ref =>
      ref.from === 'coalesce'
        ? { ...ref, refs: ref.refs.map(visit) }
        : ref.from === 'prev' && index > 0
          ? { ...ref, from: 'stage', stageKey: graph[index - 1]!.key }
          : ref;
    const map = (refs: Record<string, Ref>) =>
      Object.fromEntries(Object.entries(refs).map(([k, v]) => [k, visit(v)]));
    return {
      ...stage,
      dependsOn: stage.dependsOn ?? (index ? [graph[index - 1]!.key] : []),
      slots: map(stage.slots),
      context: map(stage.context),
      ...(stage.iterate && { iterate: { ...stage.iterate, over: visit(stage.iterate.over) } }),
      checks: stage.checks.map((check) =>
        check.type === 'script' && check.refs ? { ...check, refs: map(check.refs) } : check,
      ),
    };
  });
}

/** Stable Kahn order; ties retain the previous graph order. */
export function orderGraph(graph: StageDef[]): StageDef[] {
  const deps = stageDependencies(graph);
  const ordered: StageDef[] = [];
  const remaining = [...graph];
  while (remaining.length) {
    const i = remaining.findIndex((stage) =>
      (deps.get(stage.key) ?? []).every((key) => ordered.some((s) => s.key === key)),
    );
    if (i < 0)
      throw new Error('This connection would create a cycle or reference a missing stage.');
    ordered.push(remaining.splice(i, 1)[0]!);
  }
  return ordered;
}

export function connectStages(graph: StageDef[], source: string, target: string): StageDef[] {
  if (source === target) throw new Error('A stage cannot depend on itself.');
  if (!graph.some((s) => s.key === source) || !graph.some((s) => s.key === target))
    throw new Error('Choose two existing stages.');
  return orderGraph(
    explicitGraph(graph).map((s) =>
      s.key === target ? { ...s, dependsOn: [...new Set([...(s.dependsOn ?? []), source])] } : s,
    ),
  );
}

export function disconnectStages(graph: StageDef[], source: string, target: string): StageDef[] {
  const next = explicitGraph(graph).map((s) =>
    s.key === target ? { ...s, dependsOn: s.dependsOn?.filter((key) => key !== source) } : s,
  );
  if (stageDependencies(next).get(target)?.includes(source))
    throw new Error(
      'This connection supplies a binding. Edit its input, context, iteration, check, or memory binding in the stage inspector.',
    );
  return next;
}
