import type { StageDef } from '@reefcraft/shared';

/**
 * Locked Decision 6 — memory-writer lookup is derived client-side, never a
 * new API field. This is the flat, deduped key list `BindingPicker`'s
 * `memory` step needs; Chunk 7 extends this file for edge-drawing
 * (which stage(s) wrote a key), not just the key names.
 */
export function deriveMemoryKeys(graph: StageDef[]): string[] {
  const keys = new Set<string>();
  for (const stage of graph) {
    for (const key of Object.keys(stage.writes ?? {})) {
      keys.add(key);
    }
  }
  return [...keys];
}
