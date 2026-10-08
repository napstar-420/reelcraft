import { describe, expect, it } from 'vitest';
import { formatCapUsd } from './format-cap';

describe('formatCapUsd', () => {
  it('shows zero as unlimited and other caps as dollars', () => {
    expect(formatCapUsd(0)).toBe('Unlimited');
    expect(formatCapUsd(2.5)).toBe('$2.50');
  });
});
