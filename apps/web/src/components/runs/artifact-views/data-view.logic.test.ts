import { describe, expect, it } from 'vitest';
import {
  childPath,
  isInlineString,
  isOpenByDefault,
  jsonKind,
  summarizeValue,
} from './data-view.logic';

describe('data view logic', () => {
  it('classifies JSON values', () => {
    expect(jsonKind({ a: 1 })).toBe('object');
    expect(jsonKind([1])).toBe('array');
    expect(jsonKind('x')).toBe('string');
    expect(jsonKind(1)).toBe('number');
    expect(jsonKind(false)).toBe('boolean');
    expect(jsonKind(null)).toBe('null');
  });

  it('summarizes containers with singular and plural counts', () => {
    expect(summarizeValue([1])).toBe('1 item');
    expect(summarizeValue([1, 2, 3])).toBe('3 items');
    expect(summarizeValue({ a: 1 })).toBe('1 key');
    expect(summarizeValue({})).toBe('0 keys');
  });

  it('keeps only short single-line strings inline', () => {
    expect(isInlineString('Intro')).toBe(true);
    expect(isInlineString('a'.repeat(61))).toBe(false);
    expect(isInlineString('two\nlines')).toBe(false);
  });

  it('builds dot paths matching the API getPath syntax', () => {
    expect(childPath('', 'winner')).toBe('winner');
    expect(childPath('winner', 'key_segments')).toBe('winner.key_segments');
    expect(childPath('winner.key_segments', 0)).toBe('winner.key_segments.0');
    expect(childPath('', 2)).toBe('2');
  });

  it('opens only the top two levels by default', () => {
    expect(isOpenByDefault(0)).toBe(true);
    expect(isOpenByDefault(1)).toBe(true);
    expect(isOpenByDefault(2)).toBe(false);
  });
});
