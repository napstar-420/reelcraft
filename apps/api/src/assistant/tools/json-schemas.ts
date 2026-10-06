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
  const properties: Record<string, JsonObject> = {
    key: str('Unique stage id, e.g. "script". Never reuse a key.'),
    label: str('Name shown on the canvas.'),
    capability: str('Stage type. Look it up with get_capability first.', {
      enum: n.capabilityKeys,
    }),
    instructions: freeObject(
      '{ system?: string, template: string } — the prompt; {{ name }} fills values.',
    ),
    config: freeObject("The capability's own settings (see its configSchema)."),
    slots: freeObject('slot name → Ref (where the slot gets its value).'),
    context: freeObject('context key → Ref (extra values for the prompt).'),
    attach: {
      type: 'array',
      items: { type: 'string' },
      description: 'Context keys sent to the model as files.',
    },
    writes: freeObject('memory key → path into this stage output ("$" = whole output).'),
    output: freeObject('{ kind, … }: data (with schema), text, timeline, media.*, file.subtitles.'),
    iterate: freeObject(
      'Run once per item of a list: { over: Ref, itemAlias, itemRetryLimit, maxItems? }.',
    ),
    checks: { type: 'array', items: { type: 'object' }, description: 'Builtin or script checks.' },
    checkMaxAttempts: { type: 'integer', minimum: 1 },
    qc: freeObject('AI quality control: { criteria, threshold, model, includeInputs, … }.'),
    retryLimit: { type: 'integer', minimum: 0, description: 'Retries after a crash only.' },
    approval: freeObject('Human approval: { mode: "stage"|"item", onReject? }.'),
    budget: freeObject('{ stageCapUsd?, qcCapUsd? }.'),
    model: freeObject('{ provider, modelId, version?, params }; omit to use the default.'),
    enabledWhen: freeObject('{ input, equals }: run only when a run input has this value.'),
  };
  const shape = StageDef.shape as Record<string, { isOptional(): boolean }>;
  const required = Object.keys(shape).filter((k) => !shape[k]!.isOptional());
  return obj(properties, required);
}

export function draftJsonSchema(n: NarrowedEnums): JsonObject {
  return obj(
    {
      graph: { type: 'array', items: stageJsonSchema(n), description: 'Stages, in run order.' },
      inputs: { type: 'array', items: { type: 'object' }, description: 'What a run asks for.' },
      roles: { type: 'array', items: { type: 'object' }, maxItems: 1 },
      defaults: freeObject('Blueprint defaults layer (models, retries, caps, format).'),
      budget: obj({ runCapUsd: { type: 'number', minimum: 0 } }, ['runCapUsd']),
    },
    ['graph', 'budget'],
    'The complete blueprint draft: always send every stage, not a patch.',
  );
}
