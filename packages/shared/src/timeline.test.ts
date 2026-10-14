import { describe, expect, it } from 'vitest';
import { Timeline, timelineVersionFor } from './timeline';

const base = {
  version: 1 as const,
  canvas: { width: 1080, height: 1920, fps: 30 },
};

describe('Timeline', () => {
  it('accepts compatible media and overlay tracks', () => {
    expect(
      Timeline.parse({
        ...base,
        tracks: [
          {
            id: 'video',
            type: 'video',
            items: [{ type: 'media', handle: 'artifact:clip', startSec: 0, durationSec: 3 }],
          },
          {
            id: 'titles',
            type: 'overlay',
            items: [
              {
                type: 'text',
                text: 'Hello',
                startSec: 0,
                durationSec: 2,
                styleId: 'text.title',
                position: 'center',
              },
            ],
          },
        ],
      }).tracks,
    ).toHaveLength(2);
  });

  it('rejects duplicate tracks, incompatible items, missing duck targets, and excessive fades', () => {
    const parsed = Timeline.safeParse({
      ...base,
      tracks: [
        {
          id: 'same',
          type: 'video',
          items: [
            {
              type: 'media',
              handle: 'artifact:clip',
              startSec: 0,
              durationSec: 1,
              fadeInSec: 0.7,
              fadeOutSec: 0.7,
            },
          ],
        },
        {
          id: 'same',
          type: 'audio',
          duckUnder: 'missing',
          items: [
            {
              type: 'text',
              text: 'wrong track',
              startSec: 0,
              durationSec: 1,
              styleId: 'text.title',
              position: 'center',
            },
          ],
        },
      ],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.length).toBeGreaterThanOrEqual(4);
  });

  describe('captions', () => {
    const captions = (extra: object) =>
      Timeline.safeParse({
        ...base,
        tracks: [
          {
            id: 'captions',
            type: 'captions',
            items: [
              { type: 'captions', timingHandle: 'artifact:w', styleId: 'caption.clean', ...extra },
            ],
          },
        ],
      });

    it('still accepts captions with no pages or style (stored and model-made timelines)', () => {
      expect(captions({}).success).toBe(true);
    });

    it('accepts edited pages and style overrides', () => {
      const result = captions({
        pages: [
          {
            words: [
              { text: 'Hi', startSec: 0, endSec: 0.4 },
              { text: 'there', startSec: 0.4, endSec: 0.9 },
            ],
          },
        ],
        style: {
          wordsPerPage: 2,
          highlightColor: '#ffd84d',
          position: 'center',
          fontSize: 80,
          uppercase: true,
        },
      });
      expect(result.success).toBe(true);
    });

    it('rejects words out of order, empty pages and out-of-range style values', () => {
      expect(
        captions({
          pages: [
            {
              words: [
                { text: 'b', startSec: 1, endSec: 2 },
                { text: 'a', startSec: 0, endSec: 0.5 },
              ],
            },
          ],
        }).success,
      ).toBe(false);
      expect(captions({ pages: [{ words: [] }] }).success).toBe(false);
      expect(
        captions({ pages: [{ words: [{ text: 'x', startSec: 2, endSec: 1 }] }] }).success,
      ).toBe(false);
      expect(captions({ style: { wordsPerPage: 0 } }).success).toBe(false);
      expect(captions({ style: { position: 'left' } }).success).toBe(false);
    });
  });

  describe('transitions', () => {
    const clip = (extra: object) =>
      Timeline.safeParse({
        ...base,
        tracks: [
          {
            id: 'video',
            type: 'video',
            items: [{ type: 'media', handle: 'artifact:a', startSec: 0, durationSec: 2, ...extra }],
          },
        ],
      });

    it('accepts a transition at each end, and none (stored timelines)', () => {
      expect(clip({}).success).toBe(true);
      expect(clip({ transitionIn: { type: 'slide', durationSec: 0.5 } }).success).toBe(true);
      expect(
        clip({
          transitionIn: { type: 'crossfade', durationSec: 0.5 },
          transitionOut: { type: 'wipe', durationSec: 0.5 },
        }).success,
      ).toBe(true);
    });

    it('rejects an entry and an exit that are together longer than the clip', () => {
      const result = clip({
        transitionIn: { type: 'crossfade', durationSec: 1.5 },
        transitionOut: { type: 'crossfade', durationSec: 1 },
      });
      expect(result.success).toBe(false);
      expect(JSON.stringify(result)).toContain('combined transitions');
    });

    it('does not count a cut, and rejects a bad exit', () => {
      expect(
        clip({
          transitionIn: { type: 'cut', durationSec: 5 },
          transitionOut: { type: 'slide', durationSec: 1 },
        }).success,
      ).toBe(true);
      expect(clip({ transitionOut: { type: 'spin', durationSec: 1 } }).success).toBe(false);
      expect(clip({ transitionOut: { type: 'slide', durationSec: 0 } }).success).toBe(false);
    });
  });

  describe('version, world, camera and theme', () => {
    const theme = {
      paper: '#fbfaf5',
      ink: '#1a1a1a',
      highlight: '#ffd84a',
      accents: ['#3b82f6', '#22c55e', '#ef4444'],
      fontHand: 'Caveat',
      fontBody: 'Patrick Hand',
      strokeWidth: 4,
      roughness: 0.3,
    };

    it('stays version 1 when nothing newer is used', () => {
      expect(Timeline.parse({ ...base, tracks: [] }).version).toBe(1);
      expect(timelineVersionFor({})).toBe(1);
    });

    it('is written as version 2 when it uses a world, camera or theme', () => {
      const world = { width: 5000, height: 3000 };
      const camera = { keys: [{ atSec: 0, cx: 2500, cy: 1500, zoom: 1 }] };
      for (const extra of [{ world }, { world, camera }, { theme }]) {
        expect(Timeline.parse({ ...base, tracks: [], ...extra }).version).toBe(2);
      }
    });

    it('fixes a timeline that says version 1 but uses newer fields', () => {
      const parsed = Timeline.parse({ ...base, version: 1, tracks: [], theme });
      expect(parsed.version).toBe(2);
    });

    it('accepts a version 2 timeline that uses nothing new, and writes it as 1', () => {
      expect(Timeline.parse({ ...base, version: 2, tracks: [] }).version).toBe(1);
    });

    it('rejects a camera without a world, and unordered camera keys', () => {
      const camera = { keys: [{ atSec: 0, cx: 0, cy: 0, zoom: 1 }] };
      expect(Timeline.safeParse({ ...base, tracks: [], camera }).success).toBe(false);
      const unordered = {
        keys: [
          { atSec: 2, cx: 0, cy: 0, zoom: 1 },
          { atSec: 1, cx: 0, cy: 0, zoom: 2 },
        ],
      };
      const result = Timeline.safeParse({
        ...base,
        tracks: [],
        world: { width: 100, height: 100 },
        camera: unordered,
      });
      expect(result.success).toBe(false);
      expect(JSON.stringify(result)).toContain('time order');
    });

    it('rejects a theme that is out of range', () => {
      expect(
        Timeline.safeParse({ ...base, tracks: [], theme: { ...theme, roughness: 2 } }).success,
      ).toBe(false);
      expect(
        Timeline.safeParse({ ...base, tracks: [], theme: { ...theme, accents: [] } }).success,
      ).toBe(false);
    });
  });
});
