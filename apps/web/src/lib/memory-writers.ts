import type { StageDef } from '@reefcraft/shared';

/**
 * Locked Decision 6 — memory-writer lookup is derived client-side, never a
 * new API field, purely for `BindingPicker`'s `memory` step and Chunk 7's
 * edge-drawing. It never re-decides validity (e.g. multiple writers for one
 * key) — that stays exclusively server-authoritative via
 * `POST /blueprints/:id/validate`.
 */
export function deriveMemoryWriters(graph: StageDef[]): Map<string, string[]> {
  const writers = new Map<string, string[]>();
  for (const stage of graph) {
    for (const key of Object.keys(stage.writes ?? {})) {
      const existing = writers.get(key);
      if (existing) existing.push(stage.key);
      else writers.set(key, [stage.key]);
    }
  }
  return writers;
}

export function deriveMemoryKeys(graph: StageDef[]): string[] {
  return [...deriveMemoryWriters(graph).keys()];
}
