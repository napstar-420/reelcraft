import { Modality, StageDef } from '@reelcraft/shared';
import type { JsonObject, NarrowedEnums } from './types';

export const obj = (
  properties: Record<string, JsonObject>,
  required: string[] = [],
  description?: string,
): JsonObject => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
  ...(description ? { description } : {}),
});

export const freeObject = (description: string): JsonObject => ({ type: 'object', description });

export const str = (description?: string, extra: JsonObject = {}): JsonObject => ({
  type: 'string',
  ...(description ? { description } : {}),
  ...extra,
});

export const MODALITIES: string[] = [...Modality.options];

/** The stage's own keys, one entry per `StageDef` field. Nested values (refs, config, output,
 * checks, qc…) stay plain objects: the Zod parse and the validator are the authority on those. */
export function stageJsonSchema(n: NarrowedEnums): JsonObject {
  // Field meanings are in the guide's "stage-fields" topic: the schema stays short because every
  // draft tool sends it.
  const list = { type: 'array', items: { type: 'string' } };
  const properties: Record<string, JsonObject> = {
    key: str('Unique, never reused'),
    label: str(),
    group: str('Phase name'),
    capability: str('Stage type (get_capability first)', { enum: n.capabilityKeys }),
    instructions: freeObject('{system?, template}'),
    config: { type: 'object' },
    slots: freeObject('slot → Ref'),
    context: freeObject('key → Ref'),
    attach: list,
    writes: freeObject('memory key → path'),
    output: freeObject('{kind, schema?}'),
    iterate: freeObject('{over, itemAlias, itemRetryLimit, maxItems?, concurrency?}'),
    checks: { type: 'array', items: { type: 'object' } },
    checkMaxAttempts: { type: 'integer', minimum: 1 },
    qc: { type: 'object' },
    retryLimit: { type: 'integer', minimum: 0 },
    approval: freeObject('{mode: stage|item, onReject?}'),
    budget: freeObject('{stageCapUsd?, qcCapUsd?}'),
    model: freeObject('{provider, modelId, version?, params}'),
    disabled: { type: 'boolean' },
    enabledWhen: freeObject('{input, equals}'),
    dependsOn: list,
  };
  const shape = StageDef.shape as Record<string, { isOptional(): boolean }>;
  const required = Object.keys(shape).filter((k) => !shape[k]!.isOptional());
  return obj(properties, required, 'A stage (fields: read_guide "stage-fields").');
}

export function draftJsonSchema(n: NarrowedEnums): JsonObject {
  return obj(
    {
      graph: { type: 'array', items: stageJsonSchema(n), description: 'Stages, in run order.' },
      inputs: { type: 'array', items: { type: 'object' }, description: 'What a run asks for.' },
      roles: { type: 'array', items: { type: 'object' }, maxItems: 1 },
      defaults: freeObject('Blueprint defaults layer (models, retries, caps, format).'),
      presentation: freeObject('Canvas positions and branch names only'),
      execution: obj({ concurrentBranches: { type: 'integer', minimum: 1 } }, [
        'concurrentBranches',
      ]),
      budget: obj({ runCapUsd: { type: 'number', minimum: 0 } }, ['runCapUsd']),
    },
    ['graph', 'budget'],
    'The complete blueprint draft: always send every stage, not a patch.',
  );
}
