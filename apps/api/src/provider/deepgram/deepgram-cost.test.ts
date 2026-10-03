import { describe, expect, it } from 'vitest';
import { deepgramCostUsd } from './deepgram.adapter';

describe('deepgramCostUsd', () => {
  it('charges the per-minute price for the audio length', () => {
    expect(deepgramCostUsd(0.0043, 600)).toBeCloseTo(0.043, 6);
    expect(deepgramCostUsd(0.0043, 30)).toBeCloseTo(0.00215, 6);
  });

  it('assumes one minute when the length is unknown', () => {
    expect(deepgramCostUsd(0.0043, undefined)).toBe(0.0043);
    expect(deepgramCostUsd(0.0043, 0)).toBe(0.0043);
  });
});
