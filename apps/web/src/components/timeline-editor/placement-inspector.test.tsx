import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Timeline, TimelineItem } from '@reelcraft/shared';
import { PlacementInspector } from './placement-inspector';

const timeline = {
  version: 2,
  canvas: { width: 1920, height: 1080, fps: 30 },
  tracks: [],
  fonts: [{ family: 'Brand Sans', handle: 'asset:f' }],
} as unknown as Timeline;

const render = (item: TimelineItem, world = false) =>
  renderToStaticMarkup(
    <PlacementInspector
      item={item}
      timeline={world ? { ...timeline, world: { width: 3840, height: 2160 } } : timeline}
      readOnly={false}
      update={() => undefined}
    />,
  );

describe('PlacementInspector', () => {
  it('edits the words, box and arrival of a graphic', () => {
    const html = render({
      type: 'graphic',
      startSec: 0,
      durationSec: 2,
      x: 10,
      y: 20,
      w: 300,
      h: 80,
      content: { kind: 'text', text: 'Hello', size: 40, font: 'Brand Sans' },
      anim: { type: 'handwrite', hand: 'marker' },
      keyframes: [{ atSec: 1, scale: 1.2 }],
    });
    for (const label of ['Words', 'Letter size (px)', 'Font', 'Width', 'How it arrives', 'Pen']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('value="Hello"');
    expect(html).toContain('Moves 1 time after it arrives');
    // No world, so nothing to choose between the screen and the world.
    expect(html).not.toContain('In the world');
  });

  it('offers to place a full-frame clip in a box, and to fill the frame again', () => {
    expect(render({ type: 'media', handle: 'artifact:a', startSec: 0, durationSec: 2 })).toContain(
      'Place in a box',
    );
    const placed = render(
      {
        type: 'media',
        handle: 'artifact:a',
        startSec: 0,
        durationSec: 2,
        x: 0,
        y: 0,
        w: 100,
        h: 100,
      },
      true,
    );
    expect(placed).toContain('Fill the frame');
    expect(placed).toContain('On the screen');
    expect(placed).not.toContain('Pen');
  });
});
