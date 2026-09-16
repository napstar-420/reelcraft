import type { InputDef, RoleDef, StageDef } from '@reefcraft/shared';

export interface BlueprintValidationInput {
  graph: StageDef[];
  inputs: InputDef[];
  roles: RoleDef[];
}

export interface MemoryWriter {
  stageKey: string;
  path: string;
}

export interface ValidationContext {
  graph: StageDef[];
  stageIndexByKey: Map<string, number>;
  inputByKey: Map<string, InputDef>;
  roleKeys: Set<string>;
  /** memKey -> every stage that writes it, in graph order. */
  memoryWriters: Map<string, MemoryWriter[]>;
}

export function buildValidationContext(input: BlueprintValidationInput): ValidationContext {
  const stageIndexByKey = new Map(input.graph.map((stage, index) => [stage.key, index]));
  const inputByKey = new Map(input.inputs.map((i) => [i.key, i]));
  const roleKeys = new Set(input.roles.map((r) => r.key));

  const memoryWriters = new Map<string, MemoryWriter[]>();
  for (const stage of input.graph) {
    if (!stage.writes) continue;
    for (const [memKey, path] of Object.entries(stage.writes)) {
      const writers = memoryWriters.get(memKey) ?? [];
      writers.push({ stageKey: stage.key, path });
      memoryWriters.set(memKey, writers);
    }
  }

  return { graph: input.graph, stageIndexByKey, inputByKey, roleKeys, memoryWriters };
}
