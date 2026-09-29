import { describe, expect, it } from 'vitest';
import type { Timeline } from '@reelcraft/shared';
import { isTimeline, itemLabel, layoutTimeline } from './timeline-view.logic';

const timeline: Timeline = {
  version: 1,
  canvas: { width: 1080, height: 1920, fps: 30 },
  tracks: [
    {
      id: 'main',
      type: 'video',
      items: [
        { type: 'media', handle: 'clip-a', startSec: 0, durationSec: 4 },
        { type: 'media', handle: 'clip-b', startSec: 4, durationSec: 6 },
      ],
    },
    {
      id: 'titles',
      type: 'overlay',
      items: [
        {
          type: 'text',
          text: 'Hook',
          startSec: 1,
          durationSec: 2,
          styleId: 'bold',
          position: 'top',
        },
      ],
    },
    {
      id: 'subs',
      type: 'captions',
      items: [{ type: 'captions', timingHandle: 'vo', styleId: 'default' }],
    },
  ],
};

describe('timeline view logic', () => {
  it('recognizes timeline-shaped data', () => {
    expect(isTimeline(timeline)).toBe(true);
    expect(isTimeline({ tracks: [] })).toBe(false);
    expect(isTimeline(null)).toBe(false);
  });

  it('labels each item kind', () => {
    const [video, overlay, captions] = timeline.tracks;
    expect(itemLabel(video!.items[0]!)).toBe('clip-a');
    expect(itemLabel(overlay!.items[0]!)).toBe('Hook');
    expect(itemLabel(captions!.items[0]!)).toBe('captions · vo');
  });

  it('lays bars out as percentages of the total duration', () => {
    const { totalSec, lanes } = layoutTimeline(timeline);
    expect(totalSec).toBe(10);
    expect(lanes[0]!.bars.map((b) => [b.leftPct, b.widthPct])).toEqual([
      [0, 40],
      [40, 60],
    ]);
    expect(lanes[1]!.bars[0]).toMatchObject({ leftPct: 10, widthPct: 20 });
    expect(lanes[2]!.bars[0]).toMatchObject({ startSec: 0, endSec: 10, widthPct: 100 });
  });
});
