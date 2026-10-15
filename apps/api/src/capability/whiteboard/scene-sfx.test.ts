import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '@reelcraft/shared';
import { placeSfx, sfxFor, SFX_VOLUME } from './scene-sfx';

type Sketch = Extract<TimelineItem, { type: 'sketch' }>;

const item = (id: string, anim: Sketch['anim']['type'], startSec: number): Sketch => ({
  type: 'sketch',
  id,
  startSec,
  durationSec: 2,
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  space: 'world',
  content: { kind: 'shape', shape: 'circle' },
  anim: { type: anim },
});

describe('sound effects for a scene', () => {
  it('picks a sound from what an item is and how it appears', () => {
    expect(sfxFor(item('a:b:asset', 'draw', 0))).toBe('pencil');
    expect(sfxFor(item('a:b:label', 'handwrite', 0))).toBe('marker');
    expect(sfxFor(item('a:b:heading', 'pop', 0))).toBe('pop');
    expect(sfxFor(item('a:result:heading', 'pop', 0))).toBe('ding');
    expect(sfxFor(item('a:b:connector', 'draw', 0))).toBe('swipe');
    expect(sfxFor(item('a:b:x', 'fade', 0))).toBeUndefined();
  });

  it('puts built-in sounds at the moment each drawing starts, quietly', () => {
    const sounds = placeSfx(
      [item('a:b:asset', 'draw', 1), item('a:b:heading', 'pop', 3)],
      undefined,
    );
    expect(sounds.map((sound) => [sound.handle, sound.startSec])).toEqual([
      ['sfx:pencil', 1],
      ['sfx:pop', 3],
    ]);
    expect(sounds.every((sound) => sound.volume === SFX_VOLUME)).toBe(true);
  });

  it('drops a sound that comes within a quarter second of the one before', () => {
    const sounds = placeSfx(
      [
        item('a:b:asset', 'draw', 1),
        item('a:c:asset', 'draw', 1.1),
        item('a:d:asset', 'draw', 1.3),
      ],
      undefined,
    );
    expect(sounds.map((sound) => sound.startSec)).toEqual([1, 1.3]);
  });

  it('adds a whoosh where the camera moves, and none where it stays', () => {
    const sounds = placeSfx([], {
      keys: [
        { atSec: 0, cx: 0, cy: 0, zoom: 1 },
        { atSec: 2, cx: 0, cy: 0, zoom: 1 },
        { atSec: 3, cx: 500, cy: 0, zoom: 1 },
      ],
    });
    expect(sounds.map((sound) => [sound.handle, sound.startSec])).toEqual([['sfx:whoosh', 2]]);
  });
});
