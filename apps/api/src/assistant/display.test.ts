import { describe, expect, it } from 'vitest';
import { titleFrom, truncateForDisplay } from './display';

describe('truncateForDisplay', () => {
  it('keeps small values and bounds large ones', () => {
    expect(truncateForDisplay({ a: 1 })).toEqual({ a: 1 });
    const big = truncateForDisplay({ text: 'x'.repeat(10_000) }) as {
      truncated: boolean;
      preview: string;
    };
    expect(big.truncated).toBe(true);
    expect(big.preview.length).toBe(4000);
  });
});

describe('titleFrom', () => {
  it('uses the first line, trimmed to 60 characters', () => {
    expect(titleFrom('  Make a reel\nwith details')).toBe('Make a reel');
    expect(titleFrom('x'.repeat(100))).toHaveLength(58);
    expect(titleFrom('x'.repeat(100)).endsWith('…')).toBe(true);
  });
});
