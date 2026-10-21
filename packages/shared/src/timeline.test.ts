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

  describe('graphic items and reveals', () => {
    const graphic = (overrides: Record<string, unknown> = {}) => ({
      type: 'graphic',
      startSec: 0,
      durationSec: 2,
      x: 10,
      y: 10,
      w: 200,
      h: 100,
      content: { kind: 'shape', shape: 'arrow' },
      anim: { type: 'draw' },
      ...overrides,
    });
    const onOverlay = (item: unknown, type = 'overlay') => ({
      ...base,
      tracks: [{ id: 't', type, items: [item] }],
    });

    it('accepts a drawn item on an overlay track and writes the timeline as version 2', () => {
      const parsed = Timeline.parse(onOverlay(graphic()));
      expect(parsed.version).toBe(2);
    });

    it('accepts every kind of content', () => {
      const contents = [
        { kind: 'paths', viewBox: { width: 100, height: 100 }, strokes: [{ d: 'M0 0 L10 10' }] },
        { kind: 'text', text: 'CUE', size: 60, font: 'hand', color: 'accent1' },
        { kind: 'shape', shape: 'highlight', color: 'highlight' },
      ];
      for (const content of contents) {
        expect(Timeline.safeParse(onOverlay(graphic({ content }))).success).toBe(true);
      }
    });

    it('accepts words in coloured runs that spell the text, and refuses runs that do not', () => {
      const runs = [
        { text: 'WHAT ' },
        { text: 'REALLY', color: 'accent2', weight: 900 },
        { text: ' HAPPENS' },
      ];
      const content = (text: string) => ({ kind: 'text', text, size: 60, runs });
      expect(
        Timeline.safeParse(onOverlay(graphic({ content: content('WHAT REALLY\nHAPPENS') })))
          .success,
      ).toBe(true);
      const wrong = Timeline.safeParse(onOverlay(graphic({ content: content('WHAT HAPPENS') })));
      expect(wrong.success).toBe(false);
      expect(JSON.stringify(wrong)).toContain('the runs do not spell the same words as the text');
    });

    it('does not accept a drawn item on a video track', () => {
      const result = Timeline.safeParse(onOverlay(graphic(), 'video'));
      expect(result.success).toBe(false);
      expect(JSON.stringify(result)).toContain('graphic item is not valid on a video track');
    });

    it('rejects bad content, animation and sizes', () => {
      for (const bad of [
        { content: { kind: 'shape', shape: 'dragon' } },
        { content: { kind: 'paths', viewBox: { width: 0, height: 1 }, strokes: [{ d: 'M0 0' }] } },
        { content: { kind: 'paths', viewBox: { width: 1, height: 1 }, strokes: [] } },
        { content: { kind: 'text', text: '', size: 10 } },
        { anim: { type: 'explode' } },
        { w: 0 },
        { durationSec: 0 },
        { keyframes: [{ atSec: 0, opacity: 3 }] },
      ]) {
        expect(Timeline.safeParse(onOverlay(graphic(bad))).success, JSON.stringify(bad)).toBe(
          false,
        );
      }
    });

    it('keeps the narration cue an item was placed by', () => {
      const cue = { timingHandle: 'artifact:vo', phrase: 'the cue', offsetSec: -0.1 };
      const parsed = Timeline.parse(onOverlay(graphic({ cue })));
      expect(parsed.tracks[0]!.items[0]).toMatchObject({ cue });
    });

    it('writes a picture that is revealed as version 2, and a plain one as version 1', () => {
      const media = (extra: Record<string, unknown> = {}) => ({
        ...base,
        tracks: [
          {
            id: 'v',
            type: 'video',
            items: [
              { type: 'media', handle: 'artifact:img', startSec: 0, durationSec: 3, ...extra },
            ],
          },
        ],
      });
      expect(Timeline.parse(media()).version).toBe(1);
      expect(Timeline.parse(media({ reveal: { type: 'marker', durationSec: 1 } })).version).toBe(2);
      expect(Timeline.safeParse(media({ reveal: { type: 'melt' } })).success).toBe(false);
      expect(
        Timeline.safeParse(media({ reveal: { type: 'circle', durationSec: 0 } })).success,
      ).toBe(false);
    });

    it('says version 2 for a drawn item and a revealed picture', () => {
      expect(timelineVersionFor({ tracks: [{ items: [{ type: 'graphic' }] }] })).toBe(2);
      expect(timelineVersionFor({ tracks: [{ items: [{ type: 'media', reveal: {} }] }] })).toBe(2);
      expect(timelineVersionFor({ tracks: [{ items: [{ type: 'media' }] }] })).toBe(1);
    });
  });

  describe('placed media and generic items', () => {
    const base = { version: 1, canvas: { width: 1920, height: 1080, fps: 30 } };
    const on = (type: 'video' | 'overlay' | 'audio', extra: Record<string, unknown>) => ({
      ...base,
      tracks: [
        {
          id: 't',
          type,
          items: [{ type: 'media', handle: 'artifact:a', startSec: 0, durationSec: 3, ...extra }],
        },
      ],
    });
    const box = { x: 100, y: 80, w: 400, h: 300 };

    it('places an image in a box with an arrival and keyframes, as version 2', () => {
      const parsed = Timeline.parse(
        on('overlay', {
          ...box,
          rotate: 4,
          anim: { type: 'pop' },
          keyframes: [{ atSec: 1, x: 20 }],
        }),
      );
      expect(parsed.version).toBe(2);
      expect(parsed.tracks[0]!.items[0]).toMatchObject({ ...box, anim: { type: 'pop' } });
    });

    it('needs the whole box, and a box for anything that places', () => {
      expect(Timeline.safeParse(on('overlay', { x: 1, y: 2 })).success).toBe(false);
      expect(Timeline.safeParse(on('overlay', { anim: { type: 'pop' } })).success).toBe(false);
      expect(Timeline.safeParse(on('audio', box)).success).toBe(false);
    });

    it('lets placed media pop, fade, slide or stay, and not draw', () => {
      for (const type of ['pop', 'fade', 'slide', 'none']) {
        expect(Timeline.safeParse(on('overlay', { ...box, anim: { type } })).success).toBe(true);
      }
      for (const type of ['draw', 'handwrite', 'highlight']) {
        expect(Timeline.safeParse(on('overlay', { ...box, anim: { type } })).success).toBe(false);
      }
    });

    it('still reads a timeline saved with the item named sketch', () => {
      const parsed = Timeline.parse({
        ...base,
        tracks: [
          {
            id: 'o',
            type: 'overlay',
            items: [
              {
                type: 'sketch',
                startSec: 0,
                durationSec: 2,
                ...box,
                content: { kind: 'shape', shape: 'circle' },
                anim: { type: 'draw' },
              },
            ],
          },
        ],
      });
      expect(parsed.tracks[0]!.items[0]!.type).toBe('graphic');
      expect(parsed.version).toBe(2);
    });

    it('takes any font family, weight and right-aligned text on a drawn item', () => {
      const parsed = Timeline.parse({
        ...base,
        tracks: [
          {
            id: 'o',
            type: 'overlay',
            items: [
              {
                type: 'graphic',
                startSec: 0,
                durationSec: 2,
                ...box,
                content: {
                  kind: 'text',
                  text: 'HALF A TON',
                  size: 80,
                  font: 'Inter',
                  weight: 800,
                  align: 'right',
                },
                anim: { type: 'pop' },
              },
            ],
          },
        ],
      });
      expect(parsed.tracks[0]!.items[0]).toMatchObject({
        content: { font: 'Inter', weight: 800, align: 'right' },
      });
    });
  });
});
