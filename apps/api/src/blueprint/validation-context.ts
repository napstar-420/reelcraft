import type { InputDef, RoleDef, StageDef } from '@reelcraft/shared';

/** An `asset` row's channel-scoping/kind, as loaded by the async caller
 * (`BlueprintService`) — the validator itself stays synchronous/pure (§14.3)
 * and never touches the DB directly. */
export interface AssetLookup {
  kind: string;
  channelId: string;
}

/** Live lookup material supplied by BlueprintService; the validator remains
 * pure and records only validation findings, never database access. */
export interface CharacterLookup {
  channelId: string;
  readiness: string;
  referenceBlobIds: Set<string>;
}

export interface BlueprintValidationInput {
  graph: StageDef[];
  inputs: InputDef[];
  roles: RoleDef[];
  /** Every asset referenced by a `{from:'asset'}` ref anywhere in the graph,
   * keyed by assetId — loaded by `BlueprintService.createVersion()` before
   * calling `validate()`. Omitted (or empty) is fine when the graph has no
   * asset refs at all. */
  assetsById?: Map<string, AssetLookup>;
  /** The blueprint's own channel — an asset ref is only valid if it names an
   * asset scoped to THIS channel (§3.3). */
  blueprintChannelId?: string;
  charactersById?: Map<string, CharacterLookup>;
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
  assetsById: Map<string, AssetLookup>;
  blueprintChannelId: string;
  charactersById: Map<string, CharacterLookup>;
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

  return {
    graph: input.graph,
    stageIndexByKey,
    inputByKey,
    roleKeys,
    memoryWriters,
    assetsById: input.assetsById ?? new Map(),
    blueprintChannelId: input.blueprintChannelId ?? '',
    charactersById: input.charactersById ?? new Map(),
  };
}
