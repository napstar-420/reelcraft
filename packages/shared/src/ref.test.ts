import { describe, expect, it } from 'vitest';
import { Ref } from './ref';

describe('Ref', () => {
  it('parses a prev binding', () => {
    const ref = Ref.parse({ from: 'prev' });
    expect(ref).toEqual({ from: 'prev' });
  });

  it('parses a memory binding with a path', () => {
    const ref = Ref.parse({ from: 'memory', key: 'keyframe', path: 'style.colors' });
    expect(ref.from).toBe('memory');
  });

  it('parses an input binding with an index', () => {
    const ref = Ref.parse({ from: 'input', inputKey: 'screenshots', index: 2 });
    if (ref.from !== 'input') throw new Error('expected input variant');
    expect(ref.index).toBe(2);
  });

  it('parses a stage binding', () => {
    const ref = Ref.parse({ from: 'stage', stageKey: 'script', path: 'title', alignWith: 'item' });
    if (ref.from !== 'stage') throw new Error('expected stage variant');
    expect(ref.stageKey).toBe('script');
    expect(ref.alignWith).toBe('item');
  });

  it('parses matched stage refs and rejects incompatible options', () => {
    const base = {
      from: 'stage',
      stageKey: 'sheets',
      match: { sourcePath: 'key', itemPath: 'referenceKeys' },
    };
    expect(Ref.parse(base)).toEqual(base);
    expect(() => Ref.parse({ ...base, path: 'image' })).toThrow();
    expect(() => Ref.parse({ ...base, path: '' })).toThrow();
    expect(() => Ref.parse({ ...base, alignWith: 'item' })).toThrow();
    expect(() => Ref.parse({ ...base, match: { sourcePath: '', itemPath: 'keys' } })).toThrow();
    expect(() => Ref.parse({ ...base, match: { sourcePath: 'key', itemPath: '' } })).toThrow();
    expect(() => Ref.parse({ ...base, match: { sourcePath: 'key' } })).toThrow();
    expect(() => Ref.parse({ ...base, match: { itemPath: 'keys' } })).toThrow();
  });

  it('rejects a stage binding without a stage key', () => {
    expect(() => Ref.parse({ from: 'stage' })).toThrow();
  });

  it('rejects an unknown discriminator', () => {
    expect(() => Ref.parse({ from: 'stages', stageKey: 'x' })).toThrow();
  });

  it('parses a coalesce of nested refs', () => {
    const ref = Ref.parse({
      from: 'coalesce',
      refs: [
        { from: 'prevItem', path: 'lastFrame' },
        { from: 'const', value: 'x' },
      ],
    });
    if (ref.from !== 'coalesce') throw new Error('expected coalesce variant');
    expect(ref.refs).toHaveLength(2);
    expect(ref.refs[0]).toEqual({ from: 'prevItem', path: 'lastFrame' });
  });

  it('rejects a coalesce with fewer than two refs', () => {
    expect(() => Ref.parse({ from: 'coalesce', refs: [{ from: 'const', value: 'x' }] })).toThrow();
  });
});
