import { describe, expect, it } from 'vitest';
import {
  captionWidthAt,
  clampCaptionPoint,
} from '@reelcraft/timeline-composition/src/render-helpers';

describe('placing captions by hand', () => {
  it('keeps the point off the edges of the frame', () => {
    expect(clampCaptionPoint({ x: 0, y: 100 })).toEqual({ x: 5, y: 95 });
    expect(clampCaptionPoint({ x: 30, y: 60 })).toEqual({ x: 30, y: 60 });
  });

  it('narrows captions near an edge so they stay inside the frame', () => {
    expect(captionWidthAt(50)).toBe(86);
    expect(captionWidthAt(10)).toBe(20);
    expect(captionWidthAt(90)).toBe(20);
  });
});
