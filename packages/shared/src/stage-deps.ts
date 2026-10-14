import type { Ref } from './ref';
import type { StageDef } from './stage-def';

/**
 * Which stages a stage waits for. A stage depends on:
 * - the stages named by `dependsOn`, or (when unset) the previous stage in the graph;
 * - the stage behind every binding it reads: `prev` is the previous stage, and a
 *   memory read depends on every writer of that key that comes earlier.
 *
 * The graph array stays a valid topological order — every dependency points to an
 * earlier stage — which the validator enforces. Pure and I/O-free.
 */

/** A memory key without its `#n` item suffix. */
export function memoryBaseKey(key: string): string {
  return key.replace(/#\d+$/, '');
}

/** Every leaf ref a stage reads: slots, context, `iterate.over` and script-check
 * refs, looking inside `coalesce`. */
export function stageRefLeaves(stage: StageDef): Ref[] {
  const leaves: Ref[] = [];
  const visit = (ref: Ref): void => {
    if (ref.from === 'coalesce') ref.refs.forEach(visit);
    else leaves.push(ref);
  };
  Object.values(stage.slots).forEach(visit);
  Object.values(stage.context).forEach(visit);
  if (stage.iterate) visit(stage.iterate.over);
  for (const check of stage.checks) {
    if (check.type === 'script' && check.refs) Object.values(check.refs).forEach(visit);
  }
  return leaves;
}

/** The key of the stage a `prev` ref reads, for the stage at `stageIndex`. */
export function producerOf(
  ref: Ref,
  graph: ReadonlyArray<Pick<StageDef, 'key'>>,
  stageIndex: number,
): string | undefined {
  if (ref.from === 'prev') return stageIndex > 0 ? graph[stageIndex - 1]?.key : undefined;
  return undefined;
}

/** Keys of the stages before `stageIndex` that write `key` to Run Memory. */
export function memoryWritersBefore(
  graph: ReadonlyArray<Pick<StageDef, 'key' | 'writes'>>,
  key: string,
  stageIndex: number,
): string[] {
  const base = memoryBaseKey(key);
  return graph
    .slice(0, stageIndex)
    .filter((stage) => stage.writes && Object.keys(stage.writes).some((k) => k === base))
    .map((stage) => stage.key);
}

/** stageKey -> the keys it waits for, de-duplicated in first-seen order. Keys
 * that name no stage are kept so the validator can report them. */
export function stageDependencies(graph: ReadonlyArray<StageDef>): Map<string, string[]> {
  const deps = new Map<string, string[]>();
  graph.forEach((stage, index) => {
    const found: string[] = [];
    const add = (key: string | undefined): void => {
      if (key !== undefined && !found.includes(key)) found.push(key);
    };
    for (const key of stage.dependsOn ?? (index > 0 ? [graph[index - 1]!.key] : [])) add(key);
    for (const ref of stageRefLeaves(stage)) {
      if (ref.from === 'prev') add(producerOf(ref, graph, index));
      else if (ref.from === 'memory') {
        memoryWritersBefore(graph, ref.key, index).forEach(add);
      }
    }
    deps.set(stage.key, found);
  });
  return deps;
}

/** Every stage `key` waits for, directly or through others. Excludes `key`. */
export function ancestorsOf(deps: ReadonlyMap<string, string[]>, key: string): Set<string> {
  const found = new Set<string>();
  const queue = [...(deps.get(key) ?? [])];
  while (queue.length > 0) {
    const next = queue.pop()!;
    if (next === key || found.has(next)) continue;
    found.add(next);
    queue.push(...(deps.get(next) ?? []));
  }
  return found;
}

/** Every stage that waits for `key`, directly or through others. Excludes `key`. */
export function descendantsOf(deps: ReadonlyMap<string, string[]>, key: string): Set<string> {
  const found = new Set<string>();
  for (const other of deps.keys()) {
    if (other !== key && ancestorsOf(deps, other).has(key)) found.add(other);
  }
  return found;
}
