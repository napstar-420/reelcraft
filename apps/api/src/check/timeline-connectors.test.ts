import { describe, expect, it } from 'vitest';
import { Timeline } from '@reelcraft/shared';
import { connectorProblems } from './timeline-connectors';

const box = (id: string, extra: Record<string, unknown> = {}) => ({
  type: 'graphic',
  id,
  startSec: 0,
  durationSec: 2,
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  content: { kind: 'shape', shape: 'box' },
  anim: { type: 'none' },
  ...extra,
});
const arrow = (from: string, to: string, extra: Record<string, unknown> = {}) =>
  box('arrow', { content: { kind: 'connector', from, to }, ...extra });
const timeline = (items: unknown[]) =>
  Timeline.parse({
    version: 2,
    canvas: { width: 1920, height: 1080, fps: 30 },
    tracks: [{ id: 'overlay', type: 'overlay', items }],
  });

describe('connectorProblems', () => {
  it('passes an arrow between two items, including a placed picture', () => {
    const picture = {
      type: 'media',
      id: 'photo',
      handle: 'artifact:p',
      startSec: 0,
      x: 500,
      y: 0,
      w: 100,
      h: 100,
    };
    expect(connectorProblems(timeline([box('a'), picture, arrow('a', 'photo')]))).toEqual([]);
  });

  it('names an end that is missing, and ends in another space', () => {
    const problems = connectorProblems(
      timeline([box('a', { space: 'screen' }), arrow('a', 'gone')]),
    );
    expect(problems.map((problem) => problem.message)).toEqual([
      'arrow arrow is in the world but "a" is not',
      'arrow arrow points at "gone", which is not an item with a box',
    ]);
    expect(problems[0]!.target).toEqual({ trackId: 'overlay', itemIndex: 1 });
  });
});
