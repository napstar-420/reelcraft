import { describe, expect, it } from 'vitest';
import {
  kenBurnsTransform,
  textStyleCss,
  backgroundBox,
} from '@reelcraft/timeline-composition/src/render-helpers';

describe('kenBurnsTransform', () => {
  it('zooms in over the clip and drifts toward a corner', () => {
    expect(kenBurnsTransform(0, 0.2, 0)).toBe('scale(1.1000) translate(4.000%, 4.000%)');
    expect(kenBurnsTransform(1, 0.2, 0)).toBe('scale(1.3000) translate(-4.000%, -4.000%)');
  });

  it('drifts a different way for the next clip (unlike zoom_in)', () => {
    expect(kenBurnsTransform(1, 0.2, 1)).not.toBe(kenBurnsTransform(1, 0.2, 0));
    expect(kenBurnsTransform(1, 0.2, 4)).toBe(kenBurnsTransform(1, 0.2, 0));
  });
});

describe('textStyleCss', () => {
  it('draws the style tokens, not just the style name', () => {
    expect(
      textStyleCss({
        color: '#fff',
        fontFamily: 'Inter',
        fontSize: 72,
        fontWeight: 900,
        stroke: { color: '#000', width: 10 },
        uppercase: true,
      }),
    ).toMatchObject({
      fontSize: 72,
      fontWeight: 900,
      WebkitTextStroke: '10px #000',
      paintOrder: 'stroke fill',
      textTransform: 'uppercase',
    });
    expect(
      textStyleCss({
        color: '#fff',
        fontFamily: 'Inter',
        fontSize: 48,
        fontWeight: 600,
        background: { color: 'rgba(0,0,0,0.6)', paddingEm: 0.35, radius: 14 },
      }),
    ).toMatchObject({ backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 14 });
  });
});

describe('captions on a box', () => {
  it('keeps the boxes of a wrapped caption from overlapping', () => {
    for (const paddingEm of [0.1, 0.25, 0.35, 0.5, 0.8]) {
      const box = backgroundBox(paddingEm);
      // A line's own box is about 1.2em tall; with the padding above and below it, the next line
      // must start below that.
      expect(box.lineHeight).toBeGreaterThanOrEqual(1.2 + 2 * box.verticalEm);
    }
  });

  it('sets that line height and padding on the text', () => {
    const css = textStyleCss({
      color: '#fff',
      fontFamily: 'Arial',
      fontSize: 66,
      fontWeight: 600,
      background: { color: '#000', paddingEm: 0.35, radius: 14 },
    });
    const box = backgroundBox(0.35);
    expect(css.lineHeight).toBe(box.lineHeight);
    expect(css.padding).toBe(`${box.verticalEm}em ${box.horizontalEm}em`);
  });

  it('keeps the normal line height with no box', () => {
    expect(
      textStyleCss({ color: '#fff', fontFamily: 'Arial', fontSize: 66, fontWeight: 600 })
        .lineHeight,
    ).toBe(1.15);
  });
});
