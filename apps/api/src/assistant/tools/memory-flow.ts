import type { Ref, StageDef } from '@reelcraft/shared';

/** Every `{from:'memory'}` key a stage reads. `Ref` appears uniformly in slots, context,
 * `iterate.over` and script-check refs. */
function memoryKeysRead(stage: StageDef): string[] {
  const keys = new Set<string>();
  const note = (ref: Ref | undefined) => {
    if (ref?.from === 'memory') keys.add(ref.key);
    // a coalesce wraps other refs
    if (ref?.from === 'coalesce') ref.refs.forEach(note);
  };
  for (const ref of Object.values(stage.slots)) note(ref);
  for (const ref of Object.values(stage.context)) note(ref);
  if (stage.iterate) note(stage.iterate.over);
  for (const check of stage.checks) {
    if (check.type === 'script') for (const ref of Object.values(check.refs ?? {})) note(ref);
  }
  return [...keys];
}

export interface MemoryFlowEntry {
  key: string;
  writtenBy: string[];
  readBy: string[];
}

/** Which stages write and read each memory key: the canvas's "Memory links", as data. A key with
 * no writer, or more than one, is something the validator reports; this shows the whole picture. */
export function memoryFlow(graph: StageDef[]): MemoryFlowEntry[] {
  const flow = new Map<string, MemoryFlowEntry>();
  const entry = (key: string) => {
    let e = flow.get(key);
    if (!e) flow.set(key, (e = { key, writtenBy: [], readBy: [] }));
    return e;
  };
  for (const stage of graph) {
    for (const key of Object.keys(stage.writes ?? {})) entry(key).writtenBy.push(stage.key);
    for (const key of memoryKeysRead(stage)) entry(key).readBy.push(stage.key);
  }
  return [...flow.values()];
}
