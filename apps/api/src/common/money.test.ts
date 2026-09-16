import { describe, expect, it } from 'vitest';
import { fromUsd, toUsd } from './money';

describe('money', () => {
  it('round-trips a numeric(12,4) string through toUsd/fromUsd', () => {
    expect(toUsd('12.3400')).toBe(12.34);
    expect(fromUsd(12.34)).toBe('12.3400');
  });

  it('toUsd throws on a non-numeric string rather than returning NaN', () => {
    expect(() => toUsd('not-a-number')).toThrow('toUsd: not a numeric string');
  });

  it('fromUsd always emits 4 decimal places', () => {
    expect(fromUsd(1)).toBe('1.0000');
    expect(fromUsd(0)).toBe('0.0000');
  });
});
