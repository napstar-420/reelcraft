import { describe, expect, it } from 'vitest';
import { Timeline } from '@reelcraft/shared';
import { layoutAdvice } from './timeline-layout';

const text = (
  words: string,
  box: { x: number; y: number; w: number; h: number },
  extra: Record<string, unknown> = {},
) => ({
  type: 'graphic',
  startSec: 0,
  durationSec: 3,
  space: 'screen',
  ...box,
  content: { kind: 'text', text: words, size: 60 },
  anim: { type: 'none' },
  ...extra,
});

const timeline = (items: unknown[], extra: Record<string, unknown> = {}) =>
  Timeline.parse({
    version: 2,
    canvas: { width: 1920, height: 1080, fps: 30 },
    tracks: [{ id: 'overlay', type: 'overlay', items }],
    ...extra,
  });

const advice = (t: Timeline) =>
  Object.fromEntries(
    layoutAdvice(t)
      .filter((r) => r.warning)
      .map((r) => [r.name, r]),
  );

describe('layoutAdvice', () => {
  it('has nothing to say about a tidy layout, and never fails', () => {
    const results = layoutAdvice(timeline([text('Title', { x: 200, y: 200, w: 800, h: 120 })]));
    expect(results.every((r) => r.pass)).toBe(true);
    expect(results.filter((r) => r.warning)).toEqual([]);
    expect(results).toHaveLength(5);
  });

  it('notices words placed mostly off the frame, and words at the edge', () => {
    const found = advice(
      timeline([
        text('Gone', { x: 1700, y: 100, w: 600, h: 100 }),
        text('Edge', { x: 10, y: 500, w: 400, h: 100 }),
      ]),
    );
    expect(found['timeline.on_screen']?.message).toContain('"Gone"');
    expect(found['timeline.on_screen']?.targets).toEqual([{ trackId: 'overlay', itemIndex: 0 }]);
    expect(found['timeline.safe_area']?.targets).toEqual([{ trackId: 'overlay', itemIndex: 1 }]);
  });

  it('notices words on top of words at the same time, but not at different times', () => {
    const together = advice(
      timeline([
        text('One', { x: 200, y: 200, w: 600, h: 120 }),
        text('Two', { x: 300, y: 220, w: 600, h: 120 }),
      ]),
    );
    expect(together['timeline.text_overlap']?.targets).toHaveLength(2);
    const apart = advice(
      timeline([
        text('One', { x: 200, y: 200, w: 600, h: 120 }),
        text('Two', { x: 300, y: 220, w: 600, h: 120 }, { startSec: 3 }),
      ]),
    );
    expect(apart['timeline.text_overlap']).toBeUndefined();
  });

  it('notices things that flash past and words too small to read', () => {
    const found = advice(
      timeline([
        text('Quick', { x: 200, y: 200, w: 600, h: 120 }, { durationSec: 0.4 }),
        text(
          'Tiny',
          { x: 200, y: 600, w: 600, h: 40 },
          { content: { kind: 'text', text: 'Tiny', size: 14 } },
        ),
      ]),
    );
    expect(found['timeline.min_on_screen']?.message).toContain('0.40s');
    expect(found['timeline.text_size']?.message).toContain('"Tiny"');
  });

  it('sizes words in the world as the camera shows them', () => {
    const world = { world: { width: 3840, height: 2160 } };
    const item = text(
      'Far',
      { x: 200, y: 200, w: 600, h: 120 },
      { space: 'world', content: { kind: 'text', text: 'Far', size: 40 } },
    );
    // Without a camera the whole world is shrunk into the frame: 40px becomes 20px.
    expect(advice(timeline([item], world))['timeline.text_size']).toBeDefined();
    // A camera at zoom 1 shows it at full size.
    const camera = { camera: { keys: [{ atSec: 0, cx: 960, cy: 540, zoom: 1 }] } };
    expect(advice(timeline([item], { ...world, ...camera }))['timeline.text_size']).toBeUndefined();
  });

  it('checks clips placed in a box, but not ones that fill the frame', () => {
    const found = advice(
      timeline([
        {
          type: 'media',
          handle: 'artifact:a',
          startSec: 0,
          durationSec: 0.5,
          space: 'screen',
          x: -900,
          y: 0,
          w: 1000,
          h: 500,
        },
        { type: 'media', handle: 'artifact:b', startSec: 0, durationSec: 0.5 },
      ]),
    );
    expect(found['timeline.on_screen']?.targets).toEqual([{ trackId: 'overlay', itemIndex: 0 }]);
    expect(found['timeline.min_on_screen']?.targets).toEqual([
      { trackId: 'overlay', itemIndex: 0 },
    ]);
  });
});
