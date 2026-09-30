import type { InputDef, JsonSchema, OutputDef, Ref, StageDef } from '@reelcraft/shared';
import { deriveMemoryWriters } from './memory-writers';

export interface PathSuggestion {
  path: string;
  type: string;
}

/** `null` = the source has no fields to path into (text/media/timeline);
 * `undefined` = unknown (unset key, missing writer) — the caller then
 * leaves the path free text. */
export type SourceSchema = JsonSchema | null | undefined;

function outputSchema(output: OutputDef | undefined): SourceSchema {
  if (!output) return undefined;
  return output.kind === 'data' ? output.schema : null;
}

/** Walks a `Ref.path` (dot grammar, numeric segments index arrays) — the
 * web mirror of the API's `narrowRefPath`, minus the error messages. */
export function narrowSchema(schema: SourceSchema, path: string): SourceSchema {
  if (!schema || path === '$' || path === '') return schema;
  let current: JsonSchema | undefined = schema;
  for (const segment of path.split('.')) {
    if (!current) return undefined;
    current = /^\d+$/.test(segment) ? current.items : current.properties?.[segment];
  }
  return current;
}

/** Web mirror of the API's `sourceTypeOfRef` (blueprint/binding-types.ts),
 * for data shapes only — the server stays the authority on validity. */
export function refSourceSchema(
  ref: Ref,
  graph: StageDef[],
  stageIndex: number,
  inputs: InputDef[],
): SourceSchema {
  switch (ref.from) {
    case 'prev':
      return stageIndex > 0 ? outputSchema(graph[stageIndex - 1]?.output) : undefined;
    case 'memory': {
      const writerKey = deriveMemoryWriters(graph).get(ref.key)?.[0];
      const writer = graph.find((stage) => stage.key === writerKey);
      if (!writer) return undefined;
      return narrowSchema(outputSchema(writer.output), writer.writes?.[ref.key] ?? '$');
    }
    case 'input': {
      const input = inputs.find((i) => i.key === ref.inputKey);
      if (!input) return undefined;
      return input.accepts.kind === 'data' ? input.accepts.schema : null;
    }
    case 'item': {
      const over = graph[stageIndex]?.iterate?.over;
      if (!over) return undefined;
      const overSchema = narrowSchema(
        refSourceSchema(over, graph, stageIndex, inputs),
        'path' in over ? (over.path ?? '') : '',
      );
      return overSchema?.type === 'array' ? overSchema.items : undefined;
    }
    case 'prevItem':
      return outputSchema(graph[stageIndex]?.output);
    default:
      return null;
  }
}

/** Every dot path into `schema`, parents before children. Arrays are
 * addressed by their first item (`beats.0`) — the shape is the same for
 * every index, and the user edits the number if they need another. */
export function schemaPaths(schema: JsonSchema, maxDepth = 4): PathSuggestion[] {
  const out: PathSuggestion[] = [];
  const walk = (node: JsonSchema, prefix: string, depth: number) => {
    if (depth >= maxDepth) return;
    const children: [string, JsonSchema][] =
      node.type === 'object'
        ? Object.entries(node.properties ?? {})
        : node.type === 'array' && node.items
          ? [['0', node.items]]
          : [];
    for (const [key, child] of children) {
      const path = prefix ? `${prefix}.${key}` : key;
      out.push({ path, type: child.type });
      walk(child, path, depth + 1);
    }
  };
  walk(schema, '', 0);
  return out;
}

/** What the path box should offer for `ref`: `null` when the source has no
 * fields (the box is disabled), `undefined` when unknown (free text). */
export function pathSuggestions(
  ref: Ref,
  graph: StageDef[],
  stageIndex: number,
  inputs: InputDef[],
): PathSuggestion[] | null | undefined {
  if (ref.from === 'prevItem' && graph[stageIndex]?.output.kind === 'media.video') {
    return [
      { path: 'lastFrame', type: 'media.image' },
      { path: 'firstFrame', type: 'media.image' },
    ];
  }
  const schema = refSourceSchema(ref, graph, stageIndex, inputs);
  return schema ? schemaPaths(schema) : schema;
}
