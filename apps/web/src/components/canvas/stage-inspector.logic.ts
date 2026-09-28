import type { JsonSchema, OutputDef, OutputKind } from '@reelcraft/shared';
import type { ParsedValidationPath } from '../../lib/parse-validation-path';

function outputInstructions(output: OutputDef): string | undefined {
  return output.kind === 'text' || output.kind === 'data' ? output.instructions : undefined;
}

export function buildStageOutput(kind: OutputKind, previous: OutputDef): OutputDef {
  const instructions = outputInstructions(previous);

  switch (kind) {
    case 'data':
      return {
        kind: 'data',
        schema: previous.kind === 'data' ? previous.schema : { type: 'object' },
        schemaName: previous.kind === 'data' ? previous.schemaName : undefined,
        instructions,
      };
    case 'text':
      return { kind: 'text', instructions };
    case 'media.image':
    case 'media.video':
    case 'media.audio':
      return { kind };
    case 'file.subtitles':
      return { kind: 'file.subtitles' };
    case 'timeline':
      return { kind: 'timeline' };
  }
}

export function supportsOutputInstructions(
  capability: string,
  output: OutputDef,
): output is Extract<OutputDef, { kind: 'text' | 'data' }> {
  return capability === 'text.generate' && (output.kind === 'text' || output.kind === 'data');
}

export function updateDataOutputSchema(
  output: Extract<OutputDef, { kind: 'data' }>,
  schema: JsonSchema | undefined,
): Extract<OutputDef, { kind: 'data' }> {
  return { ...output, schema: schema ?? { type: 'object' } };
}

export function isOutputInstructionsIssue(path: ParsedValidationPath): boolean {
  return path.region === 'output' && path.name === 'instructions';
}

/** Switches an output schema's `type`, keeping `description` but dropping the
 * previous type's fields (a stale `items` left over from an old array, say)
 * rather than carrying them into a shape that no longer uses them. */
export function retypeSchema(schema: JsonSchema, type: JsonSchema['type']): JsonSchema {
  const base: JsonSchema = { type, description: schema.description };
  if (type === 'object') return { ...base, properties: {} };
  if (type === 'array') return { ...base, items: { type: 'string' } };
  return base;
}

/** Infers an output schema from a sample JSON value (from a pasted object),
 * so authors can build a schema by example instead of field-by-field. The
 * dialect (§4.2) has no null type, so `null`/`undefined` fall back to
 * `string` — a known limitation, not solved here. */
export function inferSchemaFromValue(value: unknown): JsonSchema {
  if (typeof value === 'string') return { type: 'string' };
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  if (Array.isArray(value)) {
    return {
      type: 'array',
      items: value.length > 0 ? inferSchemaFromValue(value[0]) : { type: 'string' },
    };
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return {
      type: 'object',
      properties: Object.fromEntries(entries.map(([key, v]) => [key, inferSchemaFromValue(v)])),
      required: entries.map(([key]) => key),
    };
  }
  return { type: 'string' };
}
