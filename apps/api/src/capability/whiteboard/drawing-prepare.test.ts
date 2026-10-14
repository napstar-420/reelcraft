import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { JsonSchema, VectorAssetSet } from '@reelcraft/shared';
import { WhiteboardAssetRegistry } from './asset.registry';
import {
  checkDrawing,
  prepareDrawings,
  unwrapDrawings,
  vectorAssetSetJsonSchema,
} from './drawing-prepare';

const registry = new WhiteboardAssetRegistry();
const good = (id = 'mug') => ({
  id,
  strokes: [
    { d: 'M20 80 L20 40 L70 40 L70 80 Z', weight: 'bold' },
    { d: 'M70 50 C90 50 90 70 70 70', color: 'accent1', fill: '#ffd84a' },
  ],
});

describe('checkDrawing', () => {
  it('accepts a good drawing and rewrites it in the plain form', () => {
    const result = checkDrawing(good());
    expect(result).toMatchObject({ ok: true, id: 'mug' });
    if (result.ok) {
      expect(result.strokes[0]).toEqual({ d: 'M 20 80 L 20 40 L 70 40 L 70 80 Z', weight: 'bold' });
      expect(result.strokes[1]).toMatchObject({ color: 'accent1', fill: '#ffd84a' });
    }
  });

  it('accepts every built-in drawing', () => {
    for (const entry of registry.list()) {
      expect(checkDrawing({ id: entry.id, strokes: entry.strokes }), entry.id).toMatchObject({
        ok: true,
      });
    }
  });

  it('takes the id it was asked for when the answer has none or a bad one', () => {
    expect(checkDrawing({ strokes: good().strokes }, 'asked-for')).toMatchObject({
      ok: true,
      id: 'asked-for',
    });
    expect(checkDrawing({ id: 'Bad Id', strokes: good().strokes }, 'asked-for')).toMatchObject({
      ok: true,
      id: 'asked-for',
    });
    expect(checkDrawing({ strokes: good().strokes })).toMatchObject({
      ok: false,
      issues: [{ code: 'bad_id' }],
    });
  });

  it('reports everything that is wrong at once, by stroke', () => {
    const result = checkDrawing({
      id: 'x',
      strokes: [
        { d: 'M 0 0 L 900 900' },
        { d: 'M 10 10 L 50 50', color: 'url(#evil)' },
        { d: 'M 10 10 L 50 50', weight: 'huge' },
        { d: 'L 1 1' },
        { nope: true },
        'text',
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toEqual([
        'bad_path',
        'bad_color',
        'bad_weight',
        'bad_path',
        'bad_stroke',
        'bad_stroke',
      ]);
      expect(result.issues[0]!.message).toContain('stroke 1');
      expect(result.issues[1]!.message).toContain('not a colour Reelcraft knows');
    }
  });

  it('refuses a drawing with nothing in it, too much in it, or too faint', () => {
    expect(checkDrawing('hello')).toMatchObject({ ok: false, issues: [{ code: 'not_object' }] });
    expect(checkDrawing({ id: 'x', strokes: [] })).toMatchObject({
      ok: false,
      issues: [{ code: 'no_strokes' }],
    });
    const many = Array.from({ length: 41 }, () => ({ d: 'M 10 10 L 50 50' }));
    expect(checkDrawing({ id: 'x', strokes: many })).toMatchObject({
      ok: false,
      issues: [{ code: 'too_many_strokes' }],
    });
    expect(checkDrawing({ id: 'x', strokes: [{ d: 'M 10 10 L 20 10' }] })).toMatchObject({
      ok: false,
      issues: [{ code: 'too_faint' }],
    });
  });

  it('refuses a drawing that is too detailed overall', () => {
    const detailed = Array.from({ length: 10 }, () => ({
      d: `M 5 5 ${'l 0.5 0.5 '.repeat(100)}`,
    }));
    expect(checkDrawing({ id: 'x', strokes: detailed })).toMatchObject({
      ok: false,
      issues: [{ code: 'too_big' }],
    });
  });

  it('keeps hostile text out of what it stores', () => {
    const result = checkDrawing({
      id: 'x',
      strokes: [{ d: 'M 10 10 L 90 90', color: '<script>alert(1)</script>' }],
    });
    expect(result.ok).toBe(false);
  });
});

describe('unwrapDrawings', () => {
  it('reads an array, an object holding one, one drawing, or nothing', () => {
    expect(unwrapDrawings([1, 2])).toEqual([1, 2]);
    expect(unwrapDrawings({ drawings: [1] })).toEqual([1]);
    expect(unwrapDrawings({ id: 'a' })).toEqual([{ id: 'a' }]);
    expect(unwrapDrawings(undefined)).toEqual([]);
    expect(unwrapDrawings(null)).toEqual([]);
  });
});

describe('prepareDrawings', () => {
  const needs = [
    { id: 'mug', label: 'A steaming mug', description: 'x' },
    { id: 'bulb', label: 'A lightbulb', description: 'x' },
  ];

  it('makes a set of generated drawings, labelled from the plan', () => {
    const { assets, rejected } = prepareDrawings({ drawings: [good('mug'), good('bulb')], needs });
    expect(rejected).toEqual([]);
    expect(assets.map((asset) => [asset.id, asset.label, asset.source])).toEqual([
      ['mug', 'A steaming mug', 'generated'],
      ['bulb', 'A lightbulb', 'generated'],
    ]);
    expect(VectorAssetSet.safeParse({ assets }).success).toBe(true);
  });

  it('leaves out a drawing that cannot be used and says why, keeping the rest', () => {
    const { assets, rejected } = prepareDrawings({
      drawings: [good('mug'), { id: 'bulb', strokes: [{ d: 'M 0 0 L 900 900' }] }],
      needs,
    });
    expect(assets.map((asset) => asset.id)).toEqual(['mug']);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ id: 'bulb', issues: [{ code: 'bad_path' }] });
  });

  it('takes a drawing with no id to be the one asked for at that place', () => {
    const { assets } = prepareDrawings({ drawings: [{ strokes: good().strokes }], needs });
    expect(assets[0]!.id).toBe('mug');
  });

  it('refuses a repeated id', () => {
    const { assets, rejected } = prepareDrawings({ drawings: [good('mug'), good('mug')] });
    expect(assets).toHaveLength(1);
    expect(rejected[0]!.issues[0]!.message).toContain('already used');
  });

  it('labels a drawing with no plan from its id', () => {
    expect(prepareDrawings({ drawings: [good('hot-coffee')] }).assets[0]!.label).toBe('hot coffee');
  });
});

describe('vectorAssetSetJsonSchema', () => {
  it('is in the restricted dialect and accepts a prepared set', () => {
    const schema = vectorAssetSetJsonSchema();
    expect(JsonSchema.safeParse(schema).success).toBe(true);
    const set = { assets: prepareDrawings({ drawings: [good('mug')] }).assets };
    expect(VectorAssetSet.safeParse(set).success).toBe(true);
    const validate = new Ajv({ strict: false }).compile(schema);
    expect(validate(set), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ assets: [{ id: 'x' }] })).toBe(false);
  });
});
