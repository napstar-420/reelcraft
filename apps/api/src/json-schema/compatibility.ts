import type { ArtifactKind, JsonSchema } from '@reefcraft/shared';
import type { SourceType } from './source-type';

export interface CompatibilityVerdict {
  compatible: boolean;
  reason?: string;
}

export interface CompatibilityDeps {
  /** Does `value` satisfy `schema`? Used only when a `literal` source meets
   * a schema-typed accept — the const's value IS the data, so structural
   * compatibility means it actually validates (via Ajv). Required, not
   * optional: an optional "can't verify" dep would silently mean
   * "compatible", the exact silent-pass anti-pattern chunk 2's review
   * flagged (memory writes that couldn't resolve used to write `undefined`
   * as if it were real data). */
  matchesSchema(schema: JsonSchema, value: unknown): boolean;
}

/**
 * §16.4 — nominal by kind at the top level, structural below. `accepts` is
 * OR'd across entries: compatible if the source satisfies ANY one of them.
 * An `unknown` source (its reason was already reported by the caller)
 * never gets a second issue here — it's optimistically compatible.
 */
export function isCompatible(
  source: SourceType,
  accepts: readonly (ArtifactKind | JsonSchema)[],
  deps: CompatibilityDeps,
): CompatibilityVerdict {
  if (source.kind === 'unknown') return { compatible: true };
  if (accepts.length === 0) {
    return { compatible: false, reason: 'no accepted kinds/schemas declared' };
  }

  let firstReason: string | undefined;
  for (const accept of accepts) {
    const verdict = isCompatibleWithOne(source, accept, deps);
    if (verdict.compatible) return { compatible: true };
    firstReason ??= verdict.reason;
  }
  return { compatible: false, reason: firstReason ?? 'no accepted source matched' };
}

function isCompatibleWithOne(
  source: SourceType,
  accept: ArtifactKind | JsonSchema,
  deps: CompatibilityDeps,
): CompatibilityVerdict {
  const isSchema = typeof accept === 'object';

  if (source.kind === 'literal') {
    if (!isSchema) return { compatible: true };
    return deps.matchesSchema(accept, source.value)
      ? { compatible: true }
      : { compatible: false, reason: 'literal value does not satisfy the accepted schema' };
  }

  if (!isSchema) {
    return source.kind === accept
      ? { compatible: true }
      : {
          compatible: false,
          reason: `source kind "${source.kind}" does not match accepted kind "${accept}"`,
        };
  }

  if (source.kind !== 'data') {
    return {
      compatible: false,
      reason: `source kind "${source.kind}" cannot satisfy a schema-typed accept (only "data" can)`,
    };
  }
  return isSubschema(source.schema, accept);
}

/** Does `source` satisfy everything `target` demands? Width-subtyping —
 * source may declare MORE than target requires, never less. */
export function isSubschema(source: JsonSchema, target: JsonSchema): CompatibilityVerdict {
  if (source.type !== target.type && !(source.type === 'integer' && target.type === 'number')) {
    return {
      compatible: false,
      reason: `type "${source.type}" is not assignable to "${target.type}"`,
    };
  }

  if (target.required) {
    for (const key of target.required) {
      if (!source.required?.includes(key) || !source.properties?.[key]) {
        return {
          compatible: false,
          reason: `required field "${key}" is not guaranteed present by the source schema`,
        };
      }
    }
  }

  if (target.properties) {
    for (const [key, targetProp] of Object.entries(target.properties)) {
      const sourceProp = source.properties?.[key];
      if (!sourceProp) continue; // source not declaring an optional field is fine
      const nested = isSubschema(sourceProp, targetProp);
      if (!nested.compatible) {
        return { compatible: false, reason: `property "${key}": ${nested.reason}` };
      }
    }
  }

  if (target.items) {
    if (!source.items) {
      return {
        compatible: false,
        reason: 'target requires typed array items but source does not declare "items"',
      };
    }
    const nested = isSubschema(source.items, target.items);
    if (!nested.compatible) return { compatible: false, reason: `items: ${nested.reason}` };
  }

  const boundKeys = [
    'minItems',
    'maxItems',
    'minLength',
    'maxLength',
    'minimum',
    'maximum',
  ] as const;
  for (const key of boundKeys) {
    const bound = checkBound(source, target, key);
    if (bound) return bound;
  }

  if (target.enum) {
    if (!source.enum) {
      return {
        compatible: false,
        reason: 'target restricts to an enum but source does not declare one',
      };
    }
    const targetSet = new Set(target.enum);
    if (!source.enum.every((v) => targetSet.has(v))) {
      return { compatible: false, reason: "source's enum is not a subset of target's enum" };
    }
  }

  return { compatible: true };
}

function checkBound(
  source: JsonSchema,
  target: JsonSchema,
  key: 'minItems' | 'maxItems' | 'minLength' | 'maxLength' | 'minimum' | 'maximum',
): CompatibilityVerdict | undefined {
  const targetBound = target[key];
  if (targetBound === undefined) return undefined;
  const sourceBound = source[key];
  if (sourceBound === undefined) {
    return { compatible: false, reason: `target requires "${key}" but source does not declare it` };
  }
  const isMin = key.startsWith('min');
  const ok = isMin ? sourceBound >= targetBound : sourceBound <= targetBound;
  return ok
    ? undefined
    : {
        compatible: false,
        reason: `source "${key}" (${sourceBound}) does not satisfy target's ${key} (${targetBound})`,
      };
}
