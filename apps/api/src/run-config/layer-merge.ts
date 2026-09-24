import type { ConfigLayer } from '@reelcraft/shared';

type Json = Record<string, unknown>;

function isPlainObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * §5.1 merge rules for a single object level: objects deep-merge key by
 * key, arrays and scalars replace outright, an absent (`undefined`) patch
 * key skips (base wins), and an explicit `null` patch key unsets — the key
 * is deleted from the result so a still-lower layer's value never resurfaces
 * through it. `model` (and `qc.model`, reached by the same recursion) gets
 * the extra rule below: switching `modelId` discards the old `params`
 * instead of merging into them.
 */
function mergeObjects(base: Json, patch: Json): Json {
  const result: Json = { ...base };
  for (const key of Object.keys(patch)) {
    const patchValue = patch[key];
    if (patchValue === undefined) continue;
    if (patchValue === null) {
      delete result[key];
      continue;
    }
    const baseValue = base[key];
    if (key === 'model' && isPlainObject(baseValue) && isPlainObject(patchValue)) {
      result[key] = mergeModel(baseValue, patchValue);
      continue;
    }
    if (isPlainObject(baseValue) && isPlainObject(patchValue)) {
      result[key] = mergeObjects(baseValue, patchValue);
      continue;
    }
    result[key] = patchValue;
  }
  return result;
}

function mergeModel(base: Json, patch: Json): Json {
  const baseModelId = base.modelId;
  const patchModelId = patch.modelId;
  if (
    typeof baseModelId === 'string' &&
    typeof patchModelId === 'string' &&
    baseModelId !== patchModelId
  ) {
    return patch;
  }
  return mergeObjects(base, patch);
}

/** `patch` wins over `base` per the rules above. Pure, no I/O. */
export function mergeLayer(base: ConfigLayer, patch: ConfigLayer): ConfigLayer {
  return mergeObjects(base as Json, patch as Json) as ConfigLayer;
}

/** Left-to-right fold: later layers win, per §5.2's engine -> channel ->
 * blueprint -> stage ordering. */
export function mergeLayers(...layers: ConfigLayer[]): ConfigLayer {
  return layers.reduce<ConfigLayer>((acc, layer) => mergeLayer(acc, layer), {});
}
