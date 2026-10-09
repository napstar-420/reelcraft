import { describe, expect, it } from 'vitest';
import type { StageDef } from '@reelcraft/shared';
import {
  buildStageOutput,
  DEFAULT_IMAGE_COUNT,
  MAX_IMAGE_COUNT,
  MIN_IMAGE_COUNT,
  filterAccounts,
  flowAccounts,
  toggleAccount,
  withFlowAccounts,
  ingredientCount,
  ingredientSlotName,
  imageCount,
  imageShortfall,
  pickCount,
  visibleConfigSchema,
  withImageCount,
  withImageShortfall,
  withPickCount,
  withOutputKind,
  MAX_PICK_IMAGE_COUNT,
  DEFAULT_PICK_IMAGE_COUNT,
  withIngredientCount,
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

describe('Flow ingredient inputs', () => {
  const stage = (slots: StageDef['slots'], config: StageDef['config'] = {}) =>
    ({ key: 's', capability: 'browser.flow_video', slots, config }) as StageDef;
  const bound = { from: 'asset', assetId: 'a' } as const;

  it('defaults to one and names them ingredients, ingredients2…', () => {
    expect(ingredientCount({})).toBe(1);
    expect(ingredientCount({ ingredientSlots: 3 })).toBe(3);
    expect([1, 2, 3].map(ingredientSlotName)).toEqual([
      'ingredients',
      'ingredients2',
      'ingredients3',
    ]);
  });

  it('adds one, keeping what is bound', () => {
    const next = withIngredientCount(stage({ ingredients: bound }), 2);
    expect(next.config).toEqual({ ingredientSlots: 2 });
    expect(next.slots).toEqual({ ingredients: bound });
  });

  it('removes the last one with its binding, and leaves other slots alone', () => {
    const next = withIngredientCount(
      stage({ references: bound, ingredients: bound, ingredients2: bound }, { ingredientSlots: 2 }),
      1,
    );
    expect(Object.keys(next.slots)).toEqual(['references', 'ingredients']);
    expect(withIngredientCount(next, 0).slots).toEqual({ references: bound });
    expect(withIngredientCount(next, 99).config).toEqual({ ingredientSlots: 8 });
  });

  it('hides the count from the Config form, for Flow only', () => {
    const schema = {
      type: 'object',
      properties: { aspectRatio: { type: 'string' }, ingredientSlots: { type: 'integer' } },
    } as const;
    expect(Object.keys(visibleConfigSchema('browser.flow_video', schema).properties!)).toEqual([
      'aspectRatio',
    ]);
    expect(visibleConfigSchema('video.generate', schema)).toBe(schema);
  });
});

describe('Flow stage accounts', () => {
  it('sets the list in order and drops the key when empty', () => {
    const stage = { config: { aspectRatio: '9:16' } } as unknown as StageDef;
    const set = withFlowAccounts(stage, ['a@x.com', 'b@x.com']);
    expect(set.config).toEqual({ aspectRatio: '9:16', accounts: ['a@x.com', 'b@x.com'] });
    expect(flowAccounts(set.config)).toEqual(['a@x.com', 'b@x.com']);
    expect(withFlowAccounts(set, []).config).toEqual({ aspectRatio: '9:16' });
    expect(flowAccounts({})).toEqual([]);
  });

  it('adds an account at the end and removes it when toggled again', () => {
    expect(toggleAccount(['a@x.com'], 'b@x.com')).toEqual(['a@x.com', 'b@x.com']);
    expect(toggleAccount(['a@x.com', 'b@x.com'], 'a@x.com')).toEqual(['b@x.com']);
  });

  it('filters the choices by email or name', () => {
    const choices = [
      { email: 'ava@gmail.com', name: 'Ava Stone', signedIn: true },
      { email: 'ben@work.io', name: 'Ben', signedIn: true },
    ];
    expect(filterAccounts(choices, '')).toHaveLength(2);
    expect(filterAccounts(choices, ' WORK ')).toEqual([choices[1]]);
    expect(filterAccounts(choices, 'stone')).toEqual([choices[0]]);
    expect(filterAccounts(choices, 'zzz')).toEqual([]);
  });
});

describe('Generate Image image list', () => {
  const stage = (
    config: StageDef['config'] = {},
    output: StageDef['output'] = { kind: 'media.image' },
  ) => ({ key: 's', capability: 'image.generate', slots: {}, config, output }) as StageDef;

  it('switching to an image list starts at four images and keeps a count already set', () => {
    const next = withOutputKind(stage(), 'media.image_list');
    expect(next.output).toEqual({ kind: 'media.image_list' });
    expect(next.config).toEqual({ count: DEFAULT_IMAGE_COUNT });
    expect(withOutputKind(stage({ count: 6 }), 'media.image_list').config).toEqual({ count: 6 });
  });

  it('switching back to one image drops the image list settings and nothing else', () => {
    const list = stage({ count: 5, onShortfall: 'fail', style: 'x' }, { kind: 'media.image_list' });
    const next = withOutputKind(list, 'media.image');
    expect(next.output).toEqual({ kind: 'media.image' });
    expect(next.config).toEqual({ style: 'x' });
  });

  it('leaves other capabilities config alone when the output changes', () => {
    const other = { ...stage({ count: 5 }), capability: 'video.generate' } as StageDef;
    expect(withOutputKind(other, 'media.video').config).toEqual({ count: 5 });
  });

  it('keeps the count within the allowed range', () => {
    expect(imageCount({})).toBe(DEFAULT_IMAGE_COUNT);
    expect(withImageCount(stage(), 99).config).toEqual({ count: MAX_IMAGE_COUNT });
    expect(withImageCount(stage(), 0).config).toEqual({ count: MIN_IMAGE_COUNT });
    expect(withImageCount(stage(), 3.7).config).toEqual({ count: 3 });
  });

  it('stores only a non-default shortfall mode', () => {
    expect(imageShortfall({})).toBe('warn');
    const failing = withImageShortfall(stage({ count: 3 }), 'fail');
    expect(failing.config).toEqual({ count: 3, onShortfall: 'fail' });
    expect(imageShortfall(failing.config)).toBe('fail');
    expect(withImageShortfall(failing, 'warn').config).toEqual({ count: 3 });
  });

  it('hides count and onShortfall from the generic Config form', () => {
    const schema = {
      type: 'object',
      properties: { count: { type: 'integer' }, onShortfall: { type: 'string' } },
    } as const;
    expect(visibleConfigSchema('image.generate', schema as never).properties).toEqual({});
    expect(visibleConfigSchema('video.generate', schema as never)).toBe(schema);
  });
});

describe('Generate Image candidates for quality control to pick from', () => {
  const stage = (config: StageDef['config'] = {}) =>
    ({
      key: 's',
      capability: 'image.generate',
      slots: {},
      config,
      output: { kind: 'media.image' },
    }) as StageDef;

  it('reads no candidates until a count above one is set', () => {
    expect(pickCount({})).toBeUndefined();
    expect(pickCount({ count: 1 })).toBeUndefined();
    expect(pickCount({ count: DEFAULT_PICK_IMAGE_COUNT })).toBe(DEFAULT_PICK_IMAGE_COUNT);
  });

  it('keeps the count within 2 to 4', () => {
    expect(withPickCount(stage(), 99).config).toEqual({ count: MAX_PICK_IMAGE_COUNT });
    expect(withPickCount(stage(), 0).config).toEqual({ count: MIN_IMAGE_COUNT });
    expect(withPickCount(stage(), 3.7).config).toEqual({ count: 3 });
  });

  it('turning candidates off drops count and onShortfall and nothing else', () => {
    const picking = stage({ count: 3, onShortfall: 'fail', style: 'x' });
    expect(withPickCount(picking, undefined).config).toEqual({ style: 'x' });
  });
});
