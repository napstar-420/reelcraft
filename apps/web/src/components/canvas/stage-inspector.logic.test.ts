import { describe, expect, it } from 'vitest';
import {
  buildStageOutput,
  isOutputInstructionsIssue,
  supportsOutputInstructions,
  updateDataOutputSchema,
} from './stage-inspector.logic';

describe('stage inspector output logic', () => {
  it('preserves instructions when switching between text and data', () => {
    expect(buildStageOutput('data', { kind: 'text', instructions: 'Use {{ tone }}.' })).toEqual({
      kind: 'data',
      schema: { type: 'object' },
      instructions: 'Use {{ tone }}.',
    });

    expect(
      buildStageOutput('text', {
        kind: 'data',
        schema: { type: 'object' },
        schemaName: 'Answer',
        instructions: 'Be concise.',
      }),
    ).toEqual({ kind: 'text', instructions: 'Be concise.' });
  });

  it('preserves data metadata when data remains selected', () => {
    const output = {
      kind: 'data' as const,
      schema: { type: 'array' as const, items: { type: 'string' as const } },
      schemaName: 'Tags',
      instructions: 'Return useful tags.',
    };

    expect(buildStageOutput('data', output)).toEqual(output);
  });

  it('removes instructions when switching to an unsupported output kind', () => {
    expect(
      buildStageOutput('media.image', { kind: 'text', instructions: 'Do not retain me.' }),
    ).toEqual({ kind: 'media.image' });
  });

  it('shows output instructions only for text.generate text and data outputs', () => {
    expect(supportsOutputInstructions('text.generate', { kind: 'text' })).toBe(true);
    expect(
      supportsOutputInstructions('text.generate', { kind: 'data', schema: { type: 'object' } }),
    ).toBe(true);
    expect(supportsOutputInstructions('text.generate', { kind: 'media.image' })).toBe(false);
    expect(supportsOutputInstructions('image.generate', { kind: 'text' })).toBe(false);
  });

  it('preserves data schemaName and instructions when editing the schema', () => {
    expect(
      updateDataOutputSchema(
        {
          kind: 'data',
          schema: { type: 'object' },
          schemaName: 'Answer',
          instructions: 'Use the requested language.',
        },
        { type: 'array', items: { type: 'string' } },
      ),
    ).toEqual({
      kind: 'data',
      schema: { type: 'array', items: { type: 'string' } },
      schemaName: 'Answer',
      instructions: 'Use the requested language.',
    });
  });

  it('recognizes the precise output-instructions validation path', () => {
    expect(
      isOutputInstructionsIssue({
        stageKey: 'draft',
        region: 'output',
        name: 'instructions',
        raw: 'stages.draft.output.instructions',
      }),
    ).toBe(true);
    expect(
      isOutputInstructionsIssue({
        stageKey: 'draft',
        region: 'output',
        name: 'schema',
        raw: 'stages.draft.output.schema',
      }),
    ).toBe(false);
  });
});
