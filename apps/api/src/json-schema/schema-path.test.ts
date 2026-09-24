import { describe, expect, it } from 'vitest';
import type { JsonSchema } from '@reelcraft/shared';
import { narrowRefPath, narrowTemplatePath } from './schema-path';
import type { SourceType } from './source-type';

const outlineSchema: JsonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    beats: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'beats'],
};
const dataSource: SourceType = { kind: 'data', schema: outlineSchema };

describe('narrowTemplatePath (bracket-aware)', () => {
  it('narrows a bare property', () => {
    const result = narrowTemplatePath(dataSource, 'title');
    expect(result).toEqual({ ok: true, type: { kind: 'data', schema: { type: 'string' } } });
  });

  it('narrows through a bracket index into array items', () => {
    const result = narrowTemplatePath(dataSource, 'beats[0]');
    expect(result).toEqual({ ok: true, type: { kind: 'data', schema: { type: 'string' } } });
  });

  it('fails on an unknown property', () => {
    const result = narrowTemplatePath(dataSource, 'nope');
    expect(result.ok).toBe(false);
  });

  it('fails on a text source with any path', () => {
    const result = narrowTemplatePath({ kind: 'text' }, 'x');
    expect(result.ok).toBe(false);
  });

  it('passes an empty path through unchanged', () => {
    expect(narrowTemplatePath(dataSource, '')).toEqual({ ok: true, type: dataSource });
  });

  it('narrows through a literal value', () => {
    const source: SourceType = { kind: 'literal', value: { beats: ['first', 'second'] } };
    expect(narrowTemplatePath(source, 'beats[1]')).toEqual({
      ok: true,
      type: { kind: 'literal', value: 'second' },
    });
  });
});

describe('narrowRefPath (dot-only)', () => {
  it('narrows a bare property', () => {
    const result = narrowRefPath(dataSource, 'title');
    expect(result).toEqual({ ok: true, type: { kind: 'data', schema: { type: 'string' } } });
  });

  it('indexes an array via a numeric dot segment', () => {
    const result = narrowRefPath(dataSource, 'beats.0');
    expect(result).toEqual({ ok: true, type: { kind: 'data', schema: { type: 'string' } } });
  });

  it('rejects bracket syntax outright', () => {
    const result = narrowRefPath(dataSource, 'beats[0]');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('beats.0');
  });

  it('passes an unknown source through unchanged', () => {
    const source: SourceType = { kind: 'unknown', reason: 'phase 4' };
    expect(narrowRefPath(source, 'anything')).toEqual({ ok: true, type: source });
  });
});
