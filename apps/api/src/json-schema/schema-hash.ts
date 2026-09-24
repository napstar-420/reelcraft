import { createHash } from 'node:crypto';
import type { JsonSchema } from '@reelcraft/shared';

/** Recursively sorts object keys and drops `undefined` values, so a jsonb
 * round-trip (which reorders keys, per postgres-js) can't change the
 * resulting hash. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) sorted[key] = sortKeys(v);
    }
    return sorted;
  }
  return value;
}

/** sha256 hex of the canonicalized schema. Always call this on
 * `JsonSchema.parse(...)`'s output (e.g. a `StageDef` that already came
 * through `StageDef.array().parse(...)`), never a raw/unparsed value — the
 * point is a stable hash across a jsonb round-trip, and an unparsed value
 * may carry key ordering or shape the parse would normalize. */
export function schemaHash(schema: JsonSchema): string {
  return createHash('sha256').update(canonicalJson(schema)).digest('hex');
}
