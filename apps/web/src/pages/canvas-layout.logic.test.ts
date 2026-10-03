import { describe, expect, it } from 'vitest';
import { STAGE_SPACING_X, dropIndex, stageX } from './canvas-layout.logic';

describe('dropIndex', () => {
  it('returns each slot when dropped exactly on it', () => {
    for (let index = 0; index < 5; index += 1) expect(dropIndex(stageX(index), 5)).toBe(index);
  });

  it('picks the nearest slot', () => {
    expect(dropIndex(STAGE_SPACING_X * 2 - 100, 5)).toBe(2);
    expect(dropIndex(STAGE_SPACING_X * 2 + 100, 5)).toBe(2);
    expect(dropIndex(STAGE_SPACING_X * 2 + STAGE_SPACING_X / 2 + 1, 5)).toBe(3);
  });

  it('clamps to the first and last stage', () => {
    expect(dropIndex(-900, 4)).toBe(0);
    expect(dropIndex(STAGE_SPACING_X * 40, 4)).toBe(3);
  });

  it('does not move a stage that was barely nudged (the old /250 bug)', () => {
    // With the old divisor, stage 3 nudged 20px right (x = 980) landed on slot 4.
    expect(dropIndex(stageX(3) + 20, 6)).toBe(3);
  });
});
