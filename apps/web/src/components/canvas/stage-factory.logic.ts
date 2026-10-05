import type { OutputDef, OutputKind, StageDef } from '@reelcraft/shared';

export function nextStageKey(graph: StageDef[]): string {
  const used = new Set(graph.map((s) => s.key));
  let n = 1;
  while (used.has(`stage-${n}`)) n++;
  return `stage-${n}`;
}

/** A readable default label: the capability's own label ("Generate Text"),
 * numbered when the blueprint already has a stage with that label. */
export function nextStageLabel(graph: StageDef[], base: string): string {
  const used = new Set(graph.map((s) => s.label));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** `data` needs a `schema` the new stage doesn't have yet — fall back to the
 * next allowed kind, else a placeholder empty-object schema. */
export function defaultOutput(allowedOutputs: OutputKind[]): OutputDef {
  const first = allowedOutputs[0];
  if (first && first !== 'data') return { kind: first } as OutputDef;
  const nonData = allowedOutputs.find((kind) => kind !== 'data');
  if (nonData) return { kind: nonData } as OutputDef;
  return { kind: 'data', schema: { type: 'object' } };
}

/** A fresh, empty stage for `capability`, with a unique key and label. */
export function createStage(
  graph: StageDef[],
  capability: { key: string; label: string },
  allowedOutputs: OutputKind[],
): StageDef {
  return {
    key: nextStageKey(graph),
    label: nextStageLabel(graph, capability.label),
    capability: capability.key,
    config: {},
    slots: {},
    context: {},
    output: defaultOutput(allowedOutputs),
    checks: [],
  };
}
