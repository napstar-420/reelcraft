/**
 * §6.5 — restricted prompt-templating grammar: `{{ name }}`, `{{ name.field }}`,
 * `{{ name.field.sub }}`, `{{ name.list[0].field }}`. No expressions,
 * filters, or calls. A pure module-level file (not a NestJS service) because
 * both `StageRunnerService` (orchestration) and `BlueprintValidatorService`
 * (blueprint) need it, and a DI service would force an unwanted module edge
 * between those two.
 */
const TEMPLATE_EXPR = /{{\s*([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*|\[\d+\])*)\s*}}/g;

export type PathSegment = { kind: 'prop'; name: string } | { kind: 'index'; index: number };

/** Parses a `{{ ... }}` path into typed segments — exported so
 * `json-schema/schema-path.ts` can walk a schema with the same grammar this
 * file uses to walk a runtime value, without a second copy of the regex. */
export function parseTemplatePathSegments(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  const segmentExpr = /([a-zA-Z_$][\w$]*)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = segmentExpr.exec(path))) {
    if (match[1] !== undefined) segments.push({ kind: 'prop', name: match[1] });
    else if (match[2] !== undefined) segments.push({ kind: 'index', index: Number(match[2]) });
  }
  return segments;
}

function getByPath(value: unknown, path: string): unknown {
  return parseTemplatePathSegments(path).reduce<unknown>((acc, segment) => {
    if (acc === undefined || acc === null) return undefined;
    if (segment.kind === 'index') {
      return Array.isArray(acc) ? acc[segment.index] : undefined;
    }
    if (typeof acc === 'object') {
      return (acc as Record<string, unknown>)[segment.name];
    }
    return undefined;
  }, value);
}

/** Objects/arrays interpolate as pretty-printed JSON (§6.5); scalars render
 * directly; an unresolved path renders as an empty string. */
export function renderPrompt(template: string, scope: Record<string, unknown>): string {
  return template.replace(TEMPLATE_EXPR, (_match, path: string) => {
    const value = getByPath(scope, path);
    if (value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value, null, 2);
  });
}

/** Every distinct `{{ ... }}` path referenced by the template, in first-seen
 * order — used at save time to validate each path resolves against the
 * bound slot/context schema (chunk 3's `narrow()`). */
export function parseTemplatePaths(template: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const match of template.matchAll(TEMPLATE_EXPR)) {
    const path = match[1];
    if (path && !seen.has(path)) {
      seen.add(path);
      paths.push(path);
    }
  }
  return paths;
}
