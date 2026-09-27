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

  it('rejects an unknown discriminator', () => {
    expect(() => Ref.parse({ from: 'stage', stageKey: 'x' })).toThrow();
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
