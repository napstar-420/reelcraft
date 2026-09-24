import type { JsonSchema } from '@reelcraft/shared';
import { parseTemplatePathSegments, type PathSegment } from '../common/prompt-template';
import type { SourceType } from './source-type';

export type NarrowOutcome = { ok: true; type: SourceType } | { ok: false; reason: string };

/** §6.5 grammar: `a.b[0].c` — bracket-aware, the same grammar
 * `prompt-template.ts` renders with. Used to validate every `{{ ... }}`
 * path in a stage's `instructions.template` against the schema the bound
 * slot/context name resolves to. */
export function narrowTemplatePath(source: SourceType, path: string): NarrowOutcome {
  return narrowSegments(source, parseTemplatePathSegments(path));
}

/**
 * `Ref.path` grammar: dot-only (`a.b.0`) — mirrors `common/path.ts`'s
 * `getPath`, which indexes an array via a numeric dot-segment (`'0' in acc`
 * is true for arrays) rather than bracket syntax. Bracket syntax is
 * rejected outright with an explicit message: two different path grammars
 * already exist in this codebase (chunk 2), and silently accepting the
 * wrong one here would validate a `Ref.path` that resolves to `undefined`
 * at run time.
 */
export function narrowRefPath(source: SourceType, path: string): NarrowOutcome {
  if (path.includes('[') || path.includes(']')) {
    return {
      ok: false,
      reason: 'Ref paths use "beats.0", not "beats[0]" — the bracket form is template-only',
    };
  }
  const segments: PathSegment[] = path.split('.').map((raw): PathSegment => {
    const asIndex = Number(raw);
    return Number.isInteger(asIndex) && asIndex >= 0 && String(asIndex) === raw
      ? { kind: 'index', index: asIndex }
      : { kind: 'prop', name: raw };
  });
  return narrowSegments(source, segments);
}

/** Exported so callers that already have parsed segments (the blueprint
 * validator, root-stripping a template path down to the part after the
 * bound slot/context name) can walk them directly without re-parsing a
 * path string. */
export function narrowSegments(source: SourceType, segments: PathSegment[]): NarrowOutcome {
  if (segments.length === 0) return { ok: true, type: source };
  switch (source.kind) {
    case 'data':
      return narrowDataSchema(source.schema, segments);
    case 'literal':
      return narrowLiteral(source.value, segments);
    case 'unknown':
      return { ok: true, type: source };
    default:
      return { ok: false, reason: `a "${source.kind}" artifact has no fields to path into` };
  }
}

function narrowDataSchema(schema: JsonSchema, segments: PathSegment[]): NarrowOutcome {
  let current = schema;
  for (const segment of segments) {
    if (segment.kind === 'index') {
      if (current.type !== 'array' || !current.items) {
        return { ok: false, reason: `cannot index into a "${current.type}" schema` };
      }
      current = current.items;
      continue;
    }
    const next = current.type === 'object' ? current.properties?.[segment.name] : undefined;
    if (!next) {
      return { ok: false, reason: `schema has no property "${segment.name}" at this path` };
    }
    current = next;
  }
  return { ok: true, type: { kind: 'data', schema: current } };
}

function narrowLiteral(value: unknown, segments: PathSegment[]): NarrowOutcome {
  let current = value;
  for (const segment of segments) {
    if (segment.kind === 'index') {
      if (!Array.isArray(current)) return { ok: false, reason: 'cannot index a non-array literal' };
      current = current[segment.index];
      continue;
    }
    if (current === null || typeof current !== 'object') {
      return { ok: false, reason: `literal has no property "${segment.name}" at this path` };
    }
    current = (current as Record<string, unknown>)[segment.name];
  }
  return { ok: true, type: { kind: 'literal', value: current } };
}
