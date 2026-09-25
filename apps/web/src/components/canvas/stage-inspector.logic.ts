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
