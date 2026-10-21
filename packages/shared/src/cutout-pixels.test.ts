import { describe, expect, it } from 'vitest';
import { backgroundMask, borderColor, cutOut, type Rgb } from './cutout-pixels';

/** A picture filled with one colour, with rectangles painted on it. */
function picture(
  width: number,
  height: number,
  fill: Rgb,
  rects: Array<{ x: number; y: number; w: number; h: number; color: Rgb }> = [],
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p += 1) rgba.set([...fill, 255], p * 4);
  for (const rect of rects) {
    for (let y = rect.y; y < rect.y + rect.h; y += 1) {
      for (let x = rect.x; x < rect.x + rect.w; x += 1)
        rgba.set([...rect.color, 255], (y * width + x) * 4);
    }
  }
  return rgba;
}
const alphaAt = (rgba: Uint8Array, width: number, x: number, y: number) =>
  rgba[(y * width + x) * 4 + 3];

describe('cut out', () => {
  const green: Rgb = [0, 200, 0];
  const white: Rgb = [255, 255, 255];
  const black: Rgb = [0, 0, 0];

  it('finds the background colour from the border, even with something touching it', () => {
    const rgba = picture(20, 20, green, [{ x: 0, y: 0, w: 3, h: 3, color: black }]);
    expect(borderColor(rgba, 20, 20)).toEqual(green);
  });

  it('takes the most common border colour, past a thin dark edge and a band along the bottom', () => {
    // White, with dark edges down the top of each side and a tan band along the bottom.
    const rgba = picture(30, 30, white, [
      { x: 0, y: 0, w: 1, h: 10, color: black },
      { x: 29, y: 0, w: 1, h: 10, color: black },
      { x: 0, y: 26, w: 30, h: 4, color: [203, 176, 123] },
    ]);
    expect(borderColor(rgba, 30, 30)).toEqual(white);
    const { rgba: out } = cutOut(rgba, 30, 30, { tolerance: 0.12, feather: 0 });
    expect(alphaAt(out, 30, 15, 5)).toBe(0);
    expect(alphaAt(out, 30, 15, 28)).toBe(255);
  });

  it('removes the background and keeps the subject, including its colours like the background', () => {
    // A white figure outlined in black on green; inside it, a green patch the border can't reach.
    const rgba = picture(30, 30, green, [
      { x: 5, y: 5, w: 20, h: 20, color: black },
      { x: 6, y: 6, w: 18, h: 18, color: white },
      { x: 12, y: 12, w: 6, h: 6, color: green },
    ]);
    const { rgba: out, removed } = cutOut(rgba, 30, 30, { tolerance: 0.12, feather: 0 });
    expect(alphaAt(out, 30, 0, 0)).toBe(0);
    expect(alphaAt(out, 30, 29, 29)).toBe(0);
    expect(alphaAt(out, 30, 8, 8)).toBe(255);
    expect(alphaAt(out, 30, 15, 15)).toBe(255);
    expect(removed).toBeCloseTo(1 - 400 / 900, 5);
  });

  it('takes near colours as background within the tolerance, and no further', () => {
    const rgba = picture(10, 10, white, [{ x: 0, y: 0, w: 10, h: 2, color: [240, 240, 240] }]);
    const loose = backgroundMask(rgba, 10, 10, white, 0.1);
    const strict = backgroundMask(rgba, 10, 10, white, 0.02);
    expect(loose.every((v) => v === 1)).toBe(true);
    expect(strict[0]).toBe(0);
    expect(strict[50]).toBe(1);
  });

  it('softens the edge over the feather', () => {
    const rgba = picture(20, 20, green, [{ x: 5, y: 5, w: 10, h: 10, color: black }]);
    const { rgba: out } = cutOut(rgba, 20, 20, { tolerance: 0.12, feather: 2 });
    const edge = alphaAt(out, 20, 5, 10)!;
    const inner = alphaAt(out, 20, 6, 10)!;
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(inner);
    expect(alphaAt(out, 20, 10, 10)).toBe(255);
  });
});
