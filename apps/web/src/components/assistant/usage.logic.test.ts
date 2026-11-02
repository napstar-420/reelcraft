import { describe, expect, it } from 'vitest';
import { formatTokens, fullness } from './usage.logic';

describe('chat usage', () => {
  it('writes token counts briefly', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(12_400)).toBe('12k');
    expect(formatTokens(2_340_000)).toBe('2.3M');
  });
  it('says how full the conversation is', () => {
    expect(fullness(null)).toBeNull();
    expect(fullness(75_000)).toBe(50);
    expect(fullness(400_000)).toBe(100);
  });
});
