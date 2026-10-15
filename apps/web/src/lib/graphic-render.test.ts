import { describe, expect, it } from 'vitest';
import type { GraphicContent, TimelineCamera, TimelineTheme } from '@reelcraft/shared';
import {
  animState,
  cameraAt,
  cameraTransform,
  DEFAULT_THEME,
  ease,
  hashSeed,
  keyframeState,
  pathLength,
  penPoint,
  popScale,
  resolveColor,
  revealLook,
  roughenPath,
  seededRandom,
  shapeStrokes,
  strokeWidthFor,
  visibleLengths,
  wholeWorldView,
} from '@reelcraft/timeline-composition/src/graphic/graphic-math';

const box = { w: 400, h: 100 };

describe('easing and pop', () => {
  it('starts at 0, ends at 1 and stays in range', () => {
    for (const kind of ['linear', 'in', 'out', 'in_out'] as const) {
      expect(ease(kind, 0)).toBe(0);
      expect(ease(kind, 1)).toBe(1);
      expect(ease(kind, -3)).toBe(0);
      expect(ease(kind, 9)).toBe(1);
    }
    expect(ease('in', 0.5)).toBeLessThan(0.5);
    expect(ease('out', 0.5)).toBeGreaterThan(0.5);
  });

  it('pops past full size and settles back to it', () => {
    expect(popScale(0)).toBe(0);
    expect(Math.max(...Array.from({ length: 101 }, (_, i) => popScale(i / 100)))).toBeCloseTo(
      1.1,
      2,
    );
    expect(popScale(1)).toBeCloseTo(1, 5);
  });
});

describe('colours and line weights', () => {
  const theme: TimelineTheme = { ...DEFAULT_THEME, accents: ['#111111', '#222222'] };
  it('turns theme names into colours and leaves CSS colours alone', () => {
    expect(resolveColor('ink', theme)).toBe(theme.ink);
    expect(resolveColor('accent1', theme)).toBe('#111111');
    expect(resolveColor('accent3', theme)).toBe('#111111');
    expect(resolveColor('#abcdef', theme)).toBe('#abcdef');
    expect(resolveColor(undefined, theme, 'highlight')).toBe(theme.highlight);
  });

  it('weighs lines against the theme', () => {
    expect(strokeWidthFor(undefined, theme)).toBe(theme.strokeWidth);
    expect(strokeWidthFor('thin', theme)).toBeLessThan(theme.strokeWidth);
    expect(strokeWidthFor('bold', theme)).toBeGreaterThan(theme.strokeWidth);
  });
});

describe('seeded wobble', () => {
  it('gives the same numbers for the same seed, and different ones for another', () => {
    const a = seededRandom(hashSeed('item-1'));
    const b = seededRandom(hashSeed('item-1'));
    const c = seededRandom(hashSeed('item-2'));
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
    expect(first.every((n) => n >= 0 && n < 1)).toBe(true);
  });

  it('roughens a path the same way every time, and a different way for another seed', () => {
    const d = 'M 0 0 L 100 0 L 100 100';
    const one = roughenPath(d, 'a', 3);
    expect(roughenPath(d, 'a', 3)).toBe(one);
    expect(roughenPath(d, 'b', 3)).not.toBe(one);
    expect(one).not.toBe(d);
    expect(one.startsWith('M')).toBe(true);
  });

  it('leaves a clean or unreadable path alone', () => {
    const d = 'M 0 0 L 10 10';
    expect(roughenPath(d, 'a', 0)).toBe(d);
    expect(roughenPath('not a path', 'a', 3)).toBe('not a path');
  });

  it('keeps a roughened line about as long as the original', () => {
    const d = 'M 0 0 L 200 0';
    const rough = roughenPath(d, 'seed', 2);
    expect(pathLength(rough)).toBeGreaterThan(190);
    expect(pathLength(rough)).toBeLessThan(230);
  });
});

describe('drawing lines on', () => {
  it('draws lines one after another, by length', () => {
    expect(visibleLengths([100, 100], 0)).toEqual([0, 0]);
    expect(visibleLengths([100, 100], 0.25)).toEqual([50, 0]);
    expect(visibleLengths([100, 100], 0.75)).toEqual([100, 50]);
    expect(visibleLengths([100, 100], 1)).toEqual([100, 100]);
    expect(visibleLengths([], 0.5)).toEqual([]);
  });

  it('puts the pen at the end of the line being drawn', () => {
    const paths = ['M 0 0 L 100 0', 'M 100 0 L 100 100'];
    const lengths = paths.map(pathLength);
    expect(penPoint(paths, lengths, 0)).toBeNull();
    const half = penPoint(paths, lengths, 0.25)!;
    expect(half.x).toBeCloseTo(50, 0);
    expect(half.y).toBeCloseTo(0, 0);
    const later = penPoint(paths, lengths, 0.75)!;
    expect(later.x).toBeCloseTo(100, 0);
    expect(later.y).toBeCloseTo(50, 0);
  });
});

describe('animation state', () => {
  const paths: GraphicContent = {
    kind: 'paths',
    viewBox: { width: 10, height: 10 },
    strokes: [{ d: 'M0 0 L9 9' }],
  };
  const text: GraphicContent = { kind: 'text', text: 'Hello there', size: 40 };

  it('draws a path on, then fills it in at the end', () => {
    const start = animState({ type: 'draw', durationSec: 1 }, paths, box, 5, 0);
    expect(start).toMatchObject({ draw: 0, fill: 0, drawing: false });
    const mid = animState({ type: 'draw', durationSec: 1, ease: 'linear' }, paths, box, 5, 0.5);
    expect(mid).toMatchObject({ draw: 0.5, fill: 0, drawing: true });
    const done = animState({ type: 'draw', durationSec: 1 }, paths, box, 5, 2);
    expect(done).toMatchObject({ draw: 1, fill: 1, drawing: false });
  });

  it('writes text out instead of tracing it, and swipes a marker highlight', () => {
    const written = animState({ type: 'draw', durationSec: 1, ease: 'linear' }, text, box, 5, 0.5);
    expect(written).toMatchObject({ reveal: 0.5, draw: 1 });
    const marker: GraphicContent = { kind: 'shape', shape: 'highlight' };
    expect(
      animState({ type: 'draw', durationSec: 1, ease: 'linear' }, marker, box, 5, 0.25).reveal,
    ).toBe(0.25);
    expect(
      animState({ type: 'highlight', durationSec: 1, ease: 'linear' }, text, box, 5, 0.5).reveal,
    ).toBe(0.5);
  });

  it('paces handwriting by the length of the text', () => {
    const short = animState(
      { type: 'handwrite', ease: 'linear' },
      { ...text, text: 'Hi' },
      box,
      20,
      0.3,
    );
    const long = animState(
      { type: 'handwrite', ease: 'linear' },
      { ...text, text: 'A much longer line of words to write' },
      box,
      20,
      0.3,
    );
    expect(short.reveal).toBeGreaterThan(long.reveal);
  });

  it('pops, fades and slides in', () => {
    expect(animState({ type: 'pop' }, text, box, 5, 0).scale).toBe(0);
    expect(animState({ type: 'pop' }, text, box, 5, 3).scale).toBeCloseTo(1, 5);
    expect(
      animState({ type: 'fade', durationSec: 1, ease: 'linear' }, text, box, 5, 0.5).opacity,
    ).toBe(0.5);
    const slide = animState(
      { type: 'slide', from: 'left', durationSec: 1, ease: 'linear' },
      text,
      box,
      5,
      0.5,
    );
    expect(slide.dx).toBe(-200);
    expect(slide.dy).toBe(0);
    const up = animState(
      { type: 'slide', from: 'bottom', durationSec: 1, ease: 'linear' },
      text,
      box,
      5,
      0.5,
    );
    expect(up.dy).toBe(50);
    expect(animState({ type: 'slide', from: 'left' }, text, box, 5, 3)).toMatchObject({
      dx: 0,
      dy: 0,
      opacity: 1,
    });
  });

  it('shows everything at once for none, and never runs past the item', () => {
    expect(animState({ type: 'none' }, text, box, 5, 0)).toMatchObject({
      opacity: 1,
      reveal: 1,
      draw: 1,
    });
    // A 10s animation on a 2s item finishes when the item does.
    expect(
      animState({ type: 'fade', durationSec: 10, ease: 'linear' }, text, box, 2, 2).opacity,
    ).toBe(1);
  });
});

describe('keyframes', () => {
  const keys = [
    { atSec: 1, rotate: -4, scale: 1 },
    { atSec: 3, rotate: 4, scale: 2 },
  ];
  it('holds before the first key, blends between, and holds after the last', () => {
    expect(keyframeState(keys, 0)).toMatchObject({ rotate: -4, scale: 1 });
    expect(keyframeState(keys, 2)).toMatchObject({ rotate: 0, scale: 1.5 });
    expect(keyframeState(keys, 9)).toMatchObject({ rotate: 4, scale: 2 });
  });

  it('leaves what no key sets alone, and does nothing without keys', () => {
    expect(keyframeState(keys, 2)).toMatchObject({ x: 0, y: 0, opacity: 1 });
    expect(keyframeState(undefined, 2)).toEqual({ x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 });
  });

  it('carries a property from the keys that set it, skipping those that do not', () => {
    const sparse = [
      { atSec: 0, x: 0 },
      { atSec: 1, rotate: 10 },
      { atSec: 2, x: 100 },
    ];
    expect(keyframeState(sparse, 1).x).toBe(50);
  });
});

describe('camera', () => {
  const camera: TimelineCamera = {
    keys: [
      { atSec: 0, cx: 100, cy: 100, zoom: 1 },
      { atSec: 2, cx: 300, cy: 500, zoom: 4, ease: 'linear' },
    ],
  };
  it('holds before and after, and moves between', () => {
    expect(cameraAt(camera, -1)).toEqual({ cx: 100, cy: 100, zoom: 1 });
    expect(cameraAt(camera, 5)).toEqual({ cx: 300, cy: 500, zoom: 4 });
    const mid = cameraAt(camera, 1);
    expect(mid.cx).toBe(200);
    expect(mid.cy).toBe(300);
    // Zoom is blended on a log scale: halfway from 1 to 4 is 2.
    expect(mid.zoom).toBeCloseTo(2, 5);
  });

  it('centres the camera point in the frame', () => {
    const canvas = { width: 1000, height: 500 };
    expect(cameraTransform({ cx: 500, cy: 250, zoom: 1 }, canvas)).toBe(
      'translate(0px, 0px) scale(1)',
    );
    expect(cameraTransform({ cx: 600, cy: 300, zoom: 2 }, canvas)).toBe(
      'translate(-700px, -350px) scale(2)',
    );
  });

  it('shows the whole world when there is no camera', () => {
    const view = wholeWorldView({ width: 4000, height: 2000 }, { width: 1000, height: 500 });
    expect(view).toEqual({ cx: 2000, cy: 1000, zoom: 0.25 });
  });
});

describe('built-in shapes', () => {
  it('draws every shape with valid, bounded paths', () => {
    for (const shape of ['arrow', 'circle', 'underline', 'box', 'highlight', 'check'] as const) {
      const strokes = shapeStrokes(shape, 200, 100);
      expect(strokes.length).toBeGreaterThan(0);
      for (const stroke of strokes) {
        expect(pathLength(stroke.d)).toBeGreaterThan(10);
        const numbers = stroke.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
        expect(Math.max(...numbers)).toBeLessThanOrEqual(260);
        expect(Math.min(...numbers)).toBeGreaterThanOrEqual(-20);
      }
    }
  });

  it('fills the highlight and nothing else', () => {
    expect(shapeStrokes('highlight', 10, 10)[0]!.fill).toBe('highlight');
    expect(shapeStrokes('arrow', 10, 10).every((stroke) => stroke.fill === undefined)).toBe(true);
  });
});

describe('picture reveals', () => {
  it('uncovers a picture from the left, from the middle or with a marker', () => {
    expect(revealLook('wipe_lr', 0.25)).toEqual({ clipPath: 'inset(0 75% 0 0)' });
    expect(revealLook('circle', 0.5)).toEqual({ clipPath: 'circle(37.5% at 50% 50%)' });
    expect(revealLook('marker', 0.5).maskImage).toBe(
      'linear-gradient(90deg, #000 46%, transparent 54%)',
    );
  });

  it('shows the whole picture once it is fully uncovered', () => {
    for (const type of ['wipe_lr', 'circle', 'marker'] as const) {
      expect(revealLook(type, 1)).toEqual({});
      expect(revealLook(type, 4)).toEqual({});
    }
    expect(revealLook('wipe_lr', 0)).toEqual({ clipPath: 'inset(0 100% 0 0)' });
    expect(revealLook('marker', 0).maskImage).toContain('transparent 0%');
  });
});
