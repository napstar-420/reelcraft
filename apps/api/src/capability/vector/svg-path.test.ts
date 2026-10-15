import { describe, expect, it } from 'vitest';
import { BuiltinDrawings } from './builtin-drawings';
import { isParsed, parseStrictPath, type ParsedPath, type PathIssue } from './svg-path';

const ok = (d: string): ParsedPath => {
  const result = parseStrictPath(d);
  if (!isParsed(result))
    throw new Error(`expected ${d} to parse, got ${result.code}: ${result.message}`);
  return result;
};
const bad = (d: string): PathIssue => {
  const result = parseStrictPath(d);
  if (isParsed(result)) throw new Error(`expected ${d} to be rejected`);
  return result;
};

describe('parseStrictPath: what it accepts', () => {
  it('rewrites a path in one plain form', () => {
    expect(ok('M10 10 L 90 10 L 90 90 Z').d).toBe('M 10 10 L 90 10 L 90 90 Z');
    expect(ok('m 10,10 l 20,0 l 0,20 z').d).toBe('M 10 10 L 30 10 L 30 30 Z');
  });

  it('turns relative commands into absolute ones', () => {
    expect(ok('M10 10 h 30 v 20 h -30').d).toBe('M 10 10 L 40 10 L 40 30 L 10 30');
    expect(ok('M 10 10 c 5 0 10 5 10 10').d).toBe('M 10 10 C 15 10 20 15 20 20');
    expect(ok('M 10 10 q 10 0 10 10').d).toBe('M 10 10 Q 20 10 20 20');
  });

  it('reads pairs after a move as lines, and numbers repeated after a command', () => {
    expect(ok('M 10 10 20 20 30 10').d).toBe('M 10 10 L 20 20 L 30 10');
    expect(ok('M 10 10 L 20 20 30 10').d).toBe('M 10 10 L 20 20 L 30 10');
    expect(ok('M10 10 c 1 1 2 2 3 3 1 1 2 2 3 3').d).toBe(
      'M 10 10 C 11 11 12 12 13 13 C 14 14 15 15 16 16',
    );
  });

  it('reads numbers written close together', () => {
    expect(ok('M10-10L20.5.5').d).toBe('M 10 -10 L 20.5 0.5');
    expect(ok('M1e1 1E1 L 5e0 5').d).toBe('M 10 10 L 5 5');
  });

  it('reads arcs, including flags with no space after them', () => {
    expect(ok('M 10 50 A 20 20 0 1 1 50 50').d).toBe('M 10 50 A 20 20 0 1 1 50 50');
    expect(ok('M 10 50 a20 20 0 1150 0').d).toBe('M 10 50 A 20 20 0 1 1 60 50');
    expect(ok('M 10 50 A 20 20 0 0 1 50 50 A 20 20 0 0 1 90 50').d).toContain(
      'A 20 20 0 0 1 90 50',
    );
  });

  it('follows a closed path back to where it started', () => {
    expect(ok('M 10 10 L 50 10 Z m 5 5 l 10 0').d).toBe('M 10 10 L 50 10 Z M 15 15 L 25 15');
  });

  it('counts segments and finds the box and length of what it drew', () => {
    const result = ok('M 10 20 L 60 20 L 60 70');
    expect(result.segments).toBe(3);
    expect(result.bbox).toEqual({ x1: 10, y1: 20, x2: 60, y2: 70 });
    expect(result.span).toBe(100);
  });

  it('accepts a little way outside the grid', () => {
    expect(ok('M -5 -5 L 105 105').d).toBe('M -5 -5 L 105 105');
  });

  it('accepts every built-in drawing and keeps its shape', () => {
    for (const entry of new BuiltinDrawings().list()) {
      for (const stroke of entry.strokes) {
        const first = ok(stroke.d);
        // The plain form is stable: reading it again gives the same thing.
        expect(ok(first.d).d, entry.id).toBe(first.d);
      }
    }
  });
});

describe('parseStrictPath: what it refuses', () => {
  it('refuses empty and over-long paths', () => {
    expect(bad('').code).toBe('empty');
    expect(bad('   ').code).toBe('empty');
    expect(bad(`M 0 0 ${'L 1 1 '.repeat(400)}`).code).toBe('too_long');
  });

  it('refuses anything that is not a drawing command', () => {
    for (const text of [
      'M 0 0 <script>alert(1)</script>',
      'M 0 0 L 10 10" onload="x',
      'M 0 0 L url(#a)',
      'M 0 0 javascript:alert(1)',
      'M 0 0 L 10 10; rm -rf',
      'M 0 0 L 10 10 &#x41;',
      'M 0 0 L 10 10 {}',
      'M 0 0 L 10 10 \u0000',
    ]) {
      expect(parseStrictPath(text), text).toMatchObject({
        code: expect.stringMatching(/bad_syntax|unsupported/),
      });
    }
    expect(bad('M 0 0 X 5 5').code).toBe('unsupported');
  });

  it('refuses a path that does not start with a move', () => {
    expect(bad('L 10 10 L 20 20').code).toBe('no_move');
    expect(bad('10 10 L 20 20').code).toBe('no_move');
    expect(bad('Z').code).toBe('no_move');
  });

  it('refuses commands with the wrong number of numbers', () => {
    expect(bad('M 10').code).toBe('bad_syntax');
    expect(bad('M 10 10 L 20').code).toBe('bad_syntax');
    expect(bad('M 10 10 C 1 2 3 4 5').code).toBe('bad_syntax');
    expect(bad('M 10 10 A 5 5 0 2 1 20 20').code).toBe('bad_syntax');
  });

  it('refuses numbers that are not numbers', () => {
    expect(bad('M 1e999 0 L 5 5').code).toBe('bad_syntax');
    expect(bad('M NaN 0 L 5 5').code).toBe('unsupported');
    expect(bad('M 0 0 L Infinity 5').code).toBe('unsupported');
    expect(bad('M 0 0 L 1.2.3 5').code).toMatch(/bad_syntax/);
  });

  it('refuses a path that leaves the grid, or is too small to see', () => {
    expect(bad('M 0 0 L 500 500').code).toBe('out_of_bounds');
    expect(bad('M -50 10 L 10 10').code).toBe('out_of_bounds');
    expect(bad('M 10 10 a 900 900 0 0 1 20 20').code).toBe('out_of_bounds');
    expect(bad('M 10 10 L 10.5 10.5').code).toBe('too_small');
    expect(bad('M 10 10').code).toBe('too_small');
  });

  it('refuses a path with too many segments', () => {
    expect(bad(`M 1 1 ${'l 0.1 0.1 '.repeat(130)}`).code).toBe('too_many_segments');
  });

  it('says what is wrong in words', () => {
    expect(bad('M 0 0 L 500 500').message).toContain('leaves the 100 by 100 grid');
    expect(bad('L 1 1').message).toContain('start with M');
  });
});
