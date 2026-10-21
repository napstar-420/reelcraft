import { describe, expect, it } from 'vitest';
import type { Timeline, TimelineItem } from '@reelcraft/shared';
import {
  fillFrame,
  fontChoices,
  graphicLabel,
  isPlaced,
  placeInBox,
  recolorDrawing,
  setAnim,
  setBox,
} from './placement';

type Media = Extract<TimelineItem, { type: 'media' }>;
type Graphic = Extract<TimelineItem, { type: 'graphic' }>;

const media = (extra: Partial<Media> = {}): Media => ({
  type: 'media',
  handle: 'artifact:a',
  startSec: 0,
  durationSec: 2,
  ...extra,
});
const words = (extra: Partial<Graphic> = {}): Graphic => ({
  type: 'graphic',
  startSec: 0,
  durationSec: 2,
  x: 10,
  y: 20,
  w: 300,
  h: 80,
  content: { kind: 'text', text: 'Hello', size: 40 },
  anim: { type: 'handwrite', hand: 'marker' },
  ...extra,
});
const canvas = { width: 1920, height: 1080, fps: 30 };

describe('placement', () => {
  it('knows what is placed and what to call graphics', () => {
    expect(isPlaced(media())).toBe(false);
    expect(isPlaced(media({ x: 0, y: 0, w: 10, h: 10 }))).toBe(true);
    expect(isPlaced(words())).toBe(true);
    expect(graphicLabel(words())).toBe('Hello');
    expect(graphicLabel(words({ id: 'arrow-1', content: { kind: 'shape', shape: 'arrow' } }))).toBe(
      'arrow-1',
    );
    expect(graphicLabel(words({ content: { kind: 'shape', shape: 'circle' } }))).toBe(
      'circle shape',
    );
  });

  it('moves and resizes a box, keeping sizes at least 1px', () => {
    const item = words();
    setBox(item, { x: 12.345, w: -5, h: Number.NaN });
    expect(item).toMatchObject({ x: 12.35, y: 20, w: 1, h: 80 });
  });

  it('places a full-frame clip in a box and back', () => {
    const item = media({ fit: 'cover' });
    placeInBox(item, canvas);
    expect(item).toMatchObject({ space: 'screen', x: 480, y: 270, w: 960, h: 540 });
    item.anim = { type: 'pop' };
    item.keyframes = [{ atSec: 0, scale: 1 }];
    fillFrame(item);
    expect(item).toEqual({ ...media(), fit: 'cover' });
  });

  it('keeps arrivals valid for the kind of item', () => {
    const clip = media({ x: 0, y: 0, w: 10, h: 10 });
    setAnim(clip, { type: 'draw' });
    expect(clip.anim).toBeUndefined();
    setAnim(clip, { type: 'slide' });
    expect(clip.anim).toEqual({ type: 'slide', from: 'left' });
    setAnim(clip, { type: 'fade', durationSec: 0 });
    expect(clip.anim).toEqual({ type: 'fade' });

    const item = words();
    setAnim(item, { type: 'pop' });
    expect(item.anim).toEqual({ type: 'pop' });
    setAnim(item, { type: 'draw', hand: 'pencil', durationSec: 1.5 });
    expect(item.anim).toEqual({ type: 'draw', hand: 'pencil', durationSec: 1.5 });
  });

  it('recolours every line of a drawing', () => {
    const item = words({
      content: {
        kind: 'paths',
        viewBox: { width: 100, height: 100 },
        strokes: [{ d: 'M 0 0 L 10 10', color: 'ink' }, { d: 'M 5 5 L 9 9' }],
      },
    });
    recolorDrawing(item, '#ff0000');
    expect(item.content.kind === 'paths' && item.content.strokes.map((s) => s.color)).toEqual([
      '#ff0000',
      '#ff0000',
    ]);
  });

  it('offers the theme fonts and the timeline fonts', () => {
    const timeline = {
      version: 2,
      canvas,
      tracks: [],
      fonts: [{ family: 'Brand Sans', handle: 'asset:f' }],
    } as unknown as Timeline;
    expect(fontChoices(timeline).map((c) => c.value)).toEqual(['hand', 'body', 'Brand Sans']);
  });
});
