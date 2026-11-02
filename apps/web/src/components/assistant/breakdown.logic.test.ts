import { describe, expect, it } from 'vitest';
import { MAKE_LABELS, shotAt } from './breakdown.logic';

describe('breakdown card', () => {
  const shots = [
    { index: 0, startSec: 0, endSec: 2 },
    { index: 1, startSec: 2, endSec: 5 },
  ];
  it('finds the shot playing at a time', () => {
    expect(shotAt(shots, 0)).toBe(0);
    expect(shotAt(shots, 2)).toBe(1);
    expect(shotAt(shots, 9)).toBe(1);
    expect(shotAt([], 1)).toBe(0);
  });
  it('labels every way of making a shot', () => {
    expect(Object.keys(MAKE_LABELS)).toHaveLength(7);
    expect(MAKE_LABELS.motion_graphic).toBe('Motion graphic');
  });
});
