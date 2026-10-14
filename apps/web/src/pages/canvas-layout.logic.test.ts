import { describe, expect, it } from 'vitest';
import type { StageDef } from '@reelcraft/shared';
import {
  START_NODE_WIDTH,
  START_NODE_X,
  STAGE_GAP_X,
  STAGE_NODE_WIDTH,
  STAGE_SPACING_X,
  dropIndex,
  insertButtonX,
  isChainLayout,
  reducedEdges,
  stageLayout,
  stageX,
} from './canvas-layout.logic';

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

describe('layout geometry', () => {
  it('leaves a gap between nodes for the connector', () => {
    expect(STAGE_GAP_X).toBe(STAGE_SPACING_X - STAGE_NODE_WIDTH);
    expect(STAGE_GAP_X).toBeGreaterThan(0);
  });

  it('places the Start node one gap before the first stage', () => {
    expect(START_NODE_X + START_NODE_WIDTH + STAGE_GAP_X).toBe(stageX(0));
  });

  it('centres each insert button in the gap before its slot', () => {
    expect(insertButtonX(0)).toBe(stageX(0) - STAGE_GAP_X / 2);
    expect(insertButtonX(3)).toBe(stageX(3) - STAGE_GAP_X / 2);
  });
});

function node(key: string, dependsOn?: string[]): StageDef {
  return {
    key,
    label: key,
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    ...(dependsOn ? { dependsOn } : {}),
  };
}

describe('stageLayout', () => {
  it('puts a chain in one row, one column per stage', () => {
    const layout = stageLayout([node('a'), node('b'), node('c')]);
    expect(layout).toEqual([
      { level: 0, lane: 0 },
      { level: 1, lane: 0 },
      { level: 2, lane: 0 },
    ]);
    expect(isChainLayout(layout)).toBe(true);
  });

  it('stacks stages that wait for the same stage and joins them one column later', () => {
    const layout = stageLayout([
      node('a'),
      node('b', ['a']),
      node('c', ['a']),
      node('d', ['b', 'c']),
    ]);
    expect(layout).toEqual([
      { level: 0, lane: 0 },
      { level: 1, lane: 0 },
      { level: 1, lane: 1 },
      { level: 2, lane: 0 },
    ]);
    expect(isChainLayout(layout)).toBe(false);
  });

  it('puts a stage that waits for nothing in the first column, in its own lane', () => {
    const layout = stageLayout([node('a'), node('b', [])]);
    expect(layout).toEqual([
      { level: 0, lane: 0 },
      { level: 0, lane: 1 },
    ]);
  });
});

describe('reducedEdges', () => {
  it('draws each chain link once', () => {
    expect(reducedEdges([node('a'), node('b'), node('c')])).toEqual([
      ['a', 'b'],
      ['b', 'c'],
    ]);
  });

  it('drops a dependency already reached through another', () => {
    expect(reducedEdges([node('a'), node('b', ['a']), node('c', ['a', 'b'])])).toEqual([
      ['a', 'b'],
      ['b', 'c'],
    ]);
  });
});
