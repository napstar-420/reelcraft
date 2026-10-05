import { describe, expect, it } from 'vitest';
import type { StageDef } from '@reelcraft/shared';
import {
  buildStageOutput,
  inferSchemaFromValue,
  isOutputInstructionsIssue,
  parseSchemaJson,
  retypeSchema,
  stageSectionSummaries,
  summarizeSchema,
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

  it('retypes a schema, keeping description but resetting stale fields', () => {
    expect(
      retypeSchema({ type: 'array', description: 'Tags', items: { type: 'number' } }, 'string'),
    ).toEqual({ type: 'string', description: 'Tags' });
    expect(retypeSchema({ type: 'string' }, 'object')).toEqual({
      type: 'object',
      description: undefined,
      properties: {},
    });
    expect(retypeSchema({ type: 'string' }, 'array')).toEqual({
      type: 'array',
      description: undefined,
      items: { type: 'string' },
    });
  });

  it('infers a schema from a sample scalar value', () => {
    expect(inferSchemaFromValue('hello')).toEqual({ type: 'string' });
    expect(inferSchemaFromValue(42)).toEqual({ type: 'integer' });
    expect(inferSchemaFromValue(4.2)).toEqual({ type: 'number' });
    expect(inferSchemaFromValue(true)).toEqual({ type: 'boolean' });
    expect(inferSchemaFromValue(null)).toEqual({ type: 'string' });
  });

  it('infers a nested object/array schema from a sample value', () => {
    expect(
      inferSchemaFromValue({
        title: 'Best topic',
        topicId: 18,
        tags: ['news', 'finance'],
        segments: [{ purpose: 'Explain', segment: 'Intro' }],
      }),
    ).toEqual({
      type: 'object',
      properties: {
        title: { type: 'string' },
        topicId: { type: 'integer' },
        tags: { type: 'array', items: { type: 'string' } },
        segments: {
          type: 'array',
          items: {
            type: 'object',
            properties: { purpose: { type: 'string' }, segment: { type: 'string' } },
            required: ['purpose', 'segment'],
          },
        },
      },
      required: ['title', 'topicId', 'tags', 'segments'],
    });
  });

  it('infers an empty array item schema as string when the sample array is empty', () => {
    expect(inferSchemaFromValue([])).toEqual({ type: 'array', items: { type: 'string' } });
  });

  it('summarizes a schema for a collapsed property row', () => {
    expect(summarizeSchema({ type: 'string' })).toBe('string');
    expect(summarizeSchema({ type: 'array', items: { type: 'string' } })).toBe('array of string');
    expect(
      summarizeSchema({
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'number' } },
      }),
    ).toBe('object · 2 properties');
    expect(summarizeSchema({ type: 'object' })).toBe('object · 0 properties');
  });

  it('parses valid raw JSON into a schema', () => {
    expect(parseSchemaJson('{"type":"string"}')).toEqual({ ok: true, schema: { type: 'string' } });
  });

  it('rejects invalid JSON in raw mode without touching the schema', () => {
    const result = parseSchemaJson('{not-json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not valid JSON/i);
  });

  it('rejects JSON that does not match the schema dialect', () => {
    const result = parseSchemaJson('{"type":"object","extraKey":true}');
    expect(result.ok).toBe(false);
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

describe('stageSectionSummaries', () => {
  const base: StageDef = {
    key: 's',
    label: 'S',
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
  };

  it('summarises an empty stage with defaults', () => {
    expect(stageSectionSummaries(base)).toEqual({
      basics: 'text.generate',
      data: '0 slots',
      'output-writes': 'text',
      'checks-qc': '0 checks',
      model: 'Inherited',
      execution: 'Defaults',
      flow: 'Runs once',
    });
  });

  it('reads a configured stage at a glance', () => {
    const summary = stageSectionSummaries({
      ...base,
      slots: { a: { from: 'prev' } },
      context: { c: { from: 'prev' } },
      writes: { script: '$' },
      checks: [{ type: 'builtin', key: 'k', params: {} }],
      qc: {
        criteria: 'x',
        threshold: 0.7,
        model: { provider: 'fake', modelId: 'm', params: {} },
        includeInputs: false,
      },
      model: { provider: 'openrouter', modelId: 'gpt' },
      retryLimit: 2,
      budget: { stageCapUsd: 1.5 },
      approval: { mode: 'stage' },
      enabledWhen: { input: 'x', equals: 'y' },
    });
    expect(summary.data).toBe('1 slot, 1 context');
    expect(summary['output-writes']).toBe('text → script');
    expect(summary['checks-qc']).toBe('1 check, QC on');
    expect(summary.model).toBe('gpt');
    expect(summary.execution).toBe('retry 2, cap $1.5');
    expect(summary.flow).toBe('conditional, approval');
  });
});
