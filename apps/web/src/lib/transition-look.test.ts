import { describe, expect, it } from 'vitest';
import { transitionLook } from '@reelcraft/timeline-composition/src/render-helpers';

const FPS = 30;
const LEN = 60; // a two-second clip
const look = (frame: number, clip: Parameters<typeof transitionLook>[3]) =>
  transitionLook(frame, LEN, FPS, clip);

describe('transitionLook', () => {
  it('does nothing without transitions', () => {
    expect(look(0, {})).toEqual({ opacity: 1, transform: undefined, clipPath: undefined });
    expect(look(59, {})).toEqual({ opacity: 1, transform: undefined, clipPath: undefined });
  });

  it('ignores a cut at either end', () => {
    const clip = {
      transitionIn: { type: 'cut' as const, durationSec: 1 },
      transitionOut: { type: 'cut' as const, durationSec: 1 },
    };
    expect(look(0, clip).opacity).toBe(1);
    expect(look(59, clip).opacity).toBe(1);
  });

  it('crossfades in from nothing and out to nothing', () => {
    const clip = {
      transitionIn: { type: 'crossfade' as const, durationSec: 1 },
      transitionOut: { type: 'crossfade' as const, durationSec: 1 },
    };
    expect(look(0, clip).opacity).toBe(0);
    expect(look(15, clip).opacity).toBeCloseTo(0.5);
    expect(look(30, clip).opacity).toBe(1);
    expect(look(45, clip).opacity).toBeCloseTo(0.5);
    expect(look(60, clip).opacity).toBe(0);
  });

  it('an explicit fade wins over a crossfade at the same end only', () => {
    const clip = {
      fadeOutSec: 0.5,
      transitionIn: { type: 'crossfade' as const, durationSec: 1 },
      transitionOut: { type: 'crossfade' as const, durationSec: 1 },
    };
    expect(look(15, clip).opacity).toBeCloseTo(0.5); // still fading in over 1 s
    expect(look(45, clip).opacity).toBe(1); // 0.5 s fade out has not started: 15 frames left
    expect(look(52, clip).opacity).toBeCloseTo(8 / 15);
  });

  it('slides in from the right and out to the left', () => {
    const clip = {
      transitionIn: { type: 'slide' as const, durationSec: 1 },
      transitionOut: { type: 'slide' as const, durationSec: 1 },
    };
    expect(look(0, clip).transform).toBe('translateX(100%)');
    expect(look(15, clip).transform).toBe('translateX(50%)');
    expect(look(30, clip).transform).toBeUndefined();
    expect(look(45, clip).transform).toBe('translateX(-50%)');
    expect(look(60, clip).transform).toBe('translateX(-100%)');
  });

  it('wipes in from the left and out from the left', () => {
    const clip = {
      transitionIn: { type: 'wipe' as const, durationSec: 1 },
      transitionOut: { type: 'wipe' as const, durationSec: 1 },
    };
    expect(look(0, clip).clipPath).toBe('inset(0 100% 0 0%)');
    expect(look(15, clip).clipPath).toBe('inset(0 50% 0 0%)');
    expect(look(30, clip).clipPath).toBeUndefined();
    expect(look(45, clip).clipPath).toBe('inset(0 0% 0 50%)');
    expect(look(60, clip).clipPath).toBe('inset(0 0% 0 100%)');
  });

  it('mixes kinds: slide in, fade out', () => {
    const clip = {
      transitionIn: { type: 'slide' as const, durationSec: 0.5 },
      transitionOut: { type: 'crossfade' as const, durationSec: 0.5 },
    };
    expect(look(0, clip)).toMatchObject({ transform: 'translateX(100%)', opacity: 1 });
    expect(look(60, clip)).toMatchObject({ transform: undefined, opacity: 0 });
  });
});
