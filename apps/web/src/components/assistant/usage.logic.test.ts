import { describe, expect, it } from 'vitest';
import { formatTokens } from './usage.logic';

describe('chat usage', () => {
  it('writes token counts briefly', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(12_400)).toBe('12k');
    expect(formatTokens(2_340_000)).toBe('2.3M');
  });
});
