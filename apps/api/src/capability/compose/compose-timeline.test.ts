import { describe, expect, it } from 'vitest';
import { TimelinePlan } from '@reelcraft/shared';
import type { CatalogAsset, TimelineItem } from '@reelcraft/shared';
import { fakeTimingFor } from '../../provider/fake/fake-timing';
import { AssetIndex } from './catalog';
import { composeTimeline, ComposeError, type ComposeInput } from './compose-timeline';

type Graphic = Extract<TimelineItem, { type: 'graphic' }>;
type Media = Extract<TimelineItem, { type: 'media' }>;

const drawing: CatalogAsset = {
  id: 'lightbulb',
  kind: 'vector',
  label: 'A lightbulb',
  vector: {
    id: 'lightbulb',
    label: 'A lightbulb',
    viewBox: { width: 100, height: 100 },
    strokes: [{ d: 'M30 30 L70 30 L70 70 L30 70 Z', color: 'accent1' }],
    source: 'generated',
  },
};
const catalog = (...assets: CatalogAsset[]) => AssetIndex.from(assets);
const assets = catalog(
  drawing,
  { id: 'photo', kind: 'image', handle: 'artifact:photo' },
  { id: 'clip', kind: 'video', handle: 'artifact:clip', durationSec: 4 },
  { id: 'voice', kind: 'audio', handle: 'artifact:voice', durationSec: 8 },
  { id: 'song', kind: 'audio', handle: 'asset:song', durationSec: 3 },
  { id: 'pop', kind: 'audio', handle: 'builtin:audio/pop', durationSec: 0.2 },
);
const timing = fakeTimingFor('Every dollar leaves a trail. Cash over ten thousand is reported.');

const plan = (layers: unknown[], extra: Record<string, unknown> = {}) =>
  TimelinePlan.parse({ version: 1, layers, ...extra });
const base = (overrides: Partial<ComposeInput> & { plan: TimelinePlan }): ComposeInput => ({
  canvas: { width: 1920, height: 1080, fps: 30 },
  assets,
  ...overrides,
});
const items = (timeline: ReturnType<typeof composeTimeline>['timeline'], id: string) =>
  timeline.tracks.find((track) => track.id === id)!.items;

describe('composeTimeline', () => {
  it('loads a font asset named by id, under its family, and leaves other font names alone', () => {
    const { timeline } = composeTimeline(
      base({
        assets: catalog({ id: 'brand', kind: 'font', handle: 'asset:f1', family: 'Brand Sans' }),
        plan: plan(
          [
            {
              kind: 'text',
              text: 'Hello',
              x: 0.1,
              y: 0.1,
              w: 0.5,
              h: 0.2,
              atSec: 0,
              durationSec: 2,
              font: 'brand',
            },
            {
              kind: 'text',
              text: 'There',
              x: 0.1,
              y: 0.5,
              w: 0.5,
              h: 0.2,
              atSec: 0,
              durationSec: 2,
              font: 'Georgia',
            },
          ],
          { theme: { fontBody: 'brand' } },
        ),
      }),
    );
    const words = timeline.tracks.flatMap((t) => t.items).filter((i) => i.type === 'graphic');
    expect(
      words.map((i) =>
        i.type === 'graphic' && i.content.kind === 'text' ? i.content.font : undefined,
      ),
    ).toEqual(['Brand Sans', 'Georgia']);
    expect(timeline.fonts).toEqual([{ family: 'Brand Sans', handle: 'asset:f1' }]);
    expect(timeline.theme?.fontBody).toBe('Brand Sans');
    expect(timeline.version).toBe(2);
  });

  it('places an image in a box, in pixels, with the colour behind it', () => {
    const { timeline } = composeTimeline(
      base({
        plan: plan(
          [
            {
              kind: 'image',
              asset: 'photo',
              x: 0.1,
              y: 0.2,
              w: 0.5,
              h: 0.4,
              atSec: 1,
              durationSec: 3,
              anim: 'pop',
            },
          ],
          { background: '#ffffff' },
        ),
      }),
    );
    expect(timeline.canvas.background).toBe('#ffffff');
    expect(timeline.version).toBe(2);
    expect(items(timeline, 'overlay')[0]).toMatchObject({
      type: 'media',
      handle: 'artifact:photo',
      x: 192,
      y: 216,
      w: 960,
      h: 432,
      startSec: 1,
      durationSec: 3,
      anim: { type: 'pop' },
    });
  });

  it('puts a picture with no box behind everything on the video track, for the length of the video', () => {
    const { timeline } = composeTimeline(
      base({
        plan: plan([
          { kind: 'image', asset: 'photo' },
          { kind: 'audio', asset: 'voice', track: 'voice' },
        ]),
      }),
    );
    expect(timeline.tracks.map((track) => [track.id, track.type])).toEqual([
      ['video', 'video'],
      ['voice', 'audio'],
    ]);
    // The voice is 8 s and the video runs a short rest past it.
    expect((items(timeline, 'video')[0] as Media).durationSec).toBe(8.8);
  });

  it('scales to a tall frame', () => {
    const { timeline } = composeTimeline(
      base({
        canvas: { width: 1080, height: 1920, fps: 30 },
        plan: plan([{ kind: 'image', asset: 'photo', x: 0, y: 0.5, w: 1, h: 0.5 }]),
      }),
    );
    expect(items(timeline, 'overlay')[0]).toMatchObject({ x: 0, y: 960, w: 1080, h: 960 });
  });

  it('places a drawing by id, drawn on, in the theme it is given', () => {
    const { timeline } = composeTimeline(
      base({
        hand: 'marker',
        theme: { paper: '#101010' },
        plan: plan([
          { kind: 'drawing', asset: 'lightbulb', x: 0.4, y: 0.2, w: 0.2, h: 0.3, atSec: 0.5 },
        ]),
      }),
    );
    expect(timeline.theme).toMatchObject({ paper: '#101010', fontHand: 'Caveat' });
    const [item] = items(timeline, 'overlay') as Graphic[];
    expect(item).toMatchObject({
      type: 'graphic',
      id: 'layer-1',
      x: 768,
      content: { kind: 'paths', viewBox: { width: 100, height: 100 } },
      anim: { type: 'draw', hand: 'marker' },
    });
  });

  it('recolours a drawing when the layer names a colour', () => {
    const { timeline } = composeTimeline(
      base({
        plan: plan([
          { kind: 'drawing', asset: 'lightbulb', color: '#ff0000', x: 0, y: 0, w: 0.2, h: 0.2 },
        ]),
      }),
    );
    const [item] = items(timeline, 'overlay') as Graphic[];
    expect(item!.content.kind === 'paths' && item!.content.strokes[0]!.color).toBe('#ff0000');
  });

  it('fits words to their box and lets a layer choose font, weight and alignment', () => {
    const { timeline, warnings } = composeTimeline(
      base({
        plan: plan([
          {
            kind: 'text',
            text: 'EVERY DOLLAR LEAVES A TRAIL',
            x: 0.1,
            y: 0.3,
            w: 0.3,
            h: 0.3,
            font: 'Inter',
            weight: 800,
            align: 'center',
            size: 0.2,
          },
        ]),
      }),
    );
    const [item] = items(timeline, 'overlay') as Graphic[];
    expect(item!.content).toMatchObject({
      kind: 'text',
      font: 'Inter',
      weight: 800,
      align: 'center',
    });
    expect(item!.content.kind === 'text' && item!.content.text).toContain('\n');
    expect(warnings).toEqual([]);
  });

  it('warns about words that cannot fit', () => {
    const { warnings } = composeTimeline(
      base({
        plan: plan([
          {
            kind: 'text',
            text: 'a very long line of words that will never fit',
            x: 0,
            y: 0,
            w: 0.02,
            h: 0.02,
          },
        ]),
      }),
    );
    expect(warnings.map((warning) => warning.code)).toEqual(['text_overflow']);
  });

  it('starts a layer where its words are spoken, and keeps the cue', () => {
    const { timeline, layers } = composeTimeline(
      base({
        timing,
        timingHandle: 'artifact:words',
        plan: plan([
          {
            kind: 'shape',
            shape: 'circle',
            x: 0.1,
            y: 0.1,
            w: 0.2,
            h: 0.2,
            atCue: 'cash over ten thousand',
            offsetSec: -0.1,
          },
        ]),
      }),
    );
    // "Every dollar leaves a trail." is five words at 0.4 s each.
    expect(layers[0]!.startSec).toBe(1.9);
    const [item] = items(timeline, 'overlay') as Graphic[];
    expect(item!.cue).toMatchObject({
      timingHandle: 'artifact:words',
      phrase: 'cash over ten thousand',
    });
  });

  it('places a layer after the one before when its words are not found, and says so', () => {
    const { layers, warnings } = composeTimeline(
      base({
        timing,
        plan: plan([
          { id: 'a', kind: 'shape', shape: 'box', x: 0, y: 0, w: 0.1, h: 0.1, atSec: 2 },
          {
            id: 'b',
            kind: 'shape',
            shape: 'box',
            x: 0.2,
            y: 0,
            w: 0.1,
            h: 0.1,
            atCue: 'nothing like this',
          },
        ]),
      }),
    );
    expect(layers.find((layer) => layer.id === 'b')!.startSec).toBe(2.5);
    expect(warnings.map((warning) => warning.code)).toEqual(['cue_unresolved']);
  });

  it('follows another layer, and refuses a circle or a layer with no known end', () => {
    const ok = composeTimeline(
      base({
        plan: plan([
          {
            id: 'one',
            kind: 'shape',
            shape: 'box',
            x: 0,
            y: 0,
            w: 0.1,
            h: 0.1,
            atSec: 1,
            durationSec: 2,
          },
          {
            id: 'two',
            kind: 'shape',
            shape: 'box',
            x: 0.2,
            y: 0,
            w: 0.1,
            h: 0.1,
            afterLayer: 'one',
            offsetSec: 0.5,
          },
        ]),
      }),
    );
    expect(ok.layers.find((layer) => layer.id === 'two')!.startSec).toBe(3.5);
    expect(() =>
      composeTimeline(
        base({
          plan: plan([
            { id: 'one', kind: 'shape', shape: 'box', x: 0, y: 0, w: 0.1, h: 0.1 },
            {
              id: 'two',
              kind: 'shape',
              shape: 'box',
              x: 0,
              y: 0,
              w: 0.1,
              h: 0.1,
              afterLayer: 'one',
            },
          ]),
        }),
      ),
    ).toThrow(/no known length/);
    expect(() =>
      composeTimeline(
        base({
          plan: plan([
            { id: 'one', kind: 'audio', asset: 'pop', afterLayer: 'two' },
            { id: 'two', kind: 'audio', asset: 'pop', afterLayer: 'one' },
          ]),
        }),
      ),
    ).toThrow(/in a circle/);
  });

  it('lays voice, music and sounds on tracks of their own, with music ducked and looped', () => {
    const { timeline } = composeTimeline(
      base({
        plan: plan(
          [
            { kind: 'audio', asset: 'voice', track: 'voice' },
            {
              kind: 'audio',
              asset: 'song',
              track: 'music',
              loop: true,
              volume: 0.15,
              fadeOutSec: 1,
            },
            { kind: 'audio', asset: 'pop', track: 'sfx', atSec: 1.2, volume: 0.4 },
          ],
          { ducks: [{ track: 'music', under: 'voice' }] },
        ),
      }),
    );
    expect(timeline.tracks.map((track) => [track.id, track.type])).toEqual([
      ['voice', 'audio'],
      ['music', 'audio'],
      ['sfx', 'audio'],
    ]);
    const music = timeline.tracks.find((track) => track.id === 'music')!;
    expect(music.duckUnder).toBe('voice');
    // 3 s repeated across the 8.8 s video.
    expect(music.items).toHaveLength(3);
    const last = music.items[2] as Media;
    expect(last.fadeOutSec).toBe(1);
    expect((music.items[0] as Media).fadeOutSec).toBeUndefined();
    expect(items(timeline, 'sfx')[0]).toMatchObject({
      handle: 'builtin:audio/pop',
      volume: 0.4,
      startSec: 1.2,
    });
  });

  it('moves a camera over a world that grows to hold the layers', () => {
    const { timeline } = composeTimeline(
      base({
        plan: plan(
          [
            { kind: 'shape', shape: 'circle', x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
            { kind: 'shape', shape: 'circle', x: 1.2, y: 0.1, w: 0.2, h: 0.2 },
          ],
          {
            camera: [
              { atSec: 2, x: 1.5, y: 0.5, ease: 'in_out' },
              { atSec: 4, x: 0.5, y: 0.5, zoom: 0.5 },
            ],
          },
        ),
      }),
    );
    expect(timeline.world).toEqual({ width: 3840, height: 1080 });
    expect(timeline.camera!.keys).toEqual([
      { atSec: 0, cx: 960, cy: 540, zoom: 1 },
      { atSec: 2, cx: 2880, cy: 540, zoom: 1, ease: 'in_out' },
      { atSec: 4, cx: 960, cy: 540, zoom: 0.5 },
    ]);
  });

  it('has no world or camera when everything fits the frame', () => {
    const { timeline } = composeTimeline(
      base({ plan: plan([{ kind: 'shape', shape: 'box', x: 0.1, y: 0.1, w: 0.5, h: 0.5 }]) }),
    );
    expect(timeline.world).toBeUndefined();
    expect(timeline.camera).toBeUndefined();
  });

  it('shows captions from the word timings, and skips them with a warning when there are none', () => {
    const withTiming = composeTimeline(
      base({
        timing,
        timingHandle: 'artifact:words',
        plan: plan([{ kind: 'captions', style: 'caption.bold_pop' }]),
      }),
    );
    expect(items(withTiming.timeline, 'captions')[0]).toMatchObject({
      timingHandle: 'artifact:words',
      styleId: 'caption.bold_pop',
    });
    const without = composeTimeline(
      base({ plan: plan([{ kind: 'captions' }, { kind: 'image', asset: 'photo' }]) }),
    );
    expect(without.warnings.map((warning) => warning.code)).toEqual(['captions_skipped']);
    expect(without.timeline.tracks.map((track) => track.type)).toEqual(['video']);
  });

  it('warns when a screen item leaves the frame', () => {
    const { warnings } = composeTimeline(
      base({
        plan: plan([
          { kind: 'shape', shape: 'box', x: 0.9, y: 0.1, w: 0.4, h: 0.2, space: 'screen' },
        ]),
      }),
    );
    expect(warnings.map((warning) => warning.code)).toEqual(['outside_frame']);
  });

  it('lists every problem at once, with the ids that would have worked', () => {
    let error: unknown;
    try {
      composeTimeline(
        base({
          plan: plan([
            { kind: 'drawing', asset: 'lightbulbs', x: 0, y: 0, w: 0.1, h: 0.1 },
            { kind: 'image', asset: 'voice' },
            { kind: 'text', x: 0, y: 0, w: 0.1, h: 0.1 },
            { kind: 'shape', shape: 'box' },
            { kind: 'audio', asset: 'pop', track: 'video' },
            { kind: 'image', asset: 'photo', track: 'video', x: 0, y: 0, w: 1, h: 1 },
          ]),
        }),
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ComposeError);
    const issues = (error as ComposeError).issues;
    expect(issues.join('\n')).toContain('no drawing asset "lightbulbs". Available: lightbulb');
    expect(issues.join('\n')).toContain('asset "voice" is audio, not usable as image');
    expect(issues.join('\n')).toContain('needs text');
    expect(issues.join('\n')).toContain('needs x, y, w and h');
  });

  it('refuses two layers called the same, and a track used for two kinds of thing', () => {
    expect(() =>
      composeTimeline(
        base({
          plan: plan([
            { id: 'a', kind: 'shape', shape: 'box', x: 0, y: 0, w: 0.1, h: 0.1 },
            { id: 'a', kind: 'shape', shape: 'box', x: 0, y: 0, w: 0.1, h: 0.1 },
          ]),
        }),
      ),
    ).toThrow(/two layers are called "a"/);
    expect(() =>
      composeTimeline(
        base({
          plan: plan([
            { kind: 'audio', asset: 'pop', track: 'x' },
            { kind: 'shape', shape: 'box', x: 0, y: 0, w: 0.1, h: 0.1, track: 'x' },
          ]),
        }),
      ),
    ).toThrow(/track "x" is a audio track/);
  });

  it('is the same every time', () => {
    const input = base({
      timing,
      plan: plan([
        { kind: 'audio', asset: 'voice', track: 'voice' },
        { kind: 'drawing', asset: 'lightbulb', x: 0.1, y: 0.1, w: 0.2, h: 0.2, atCue: 'a trail' },
      ]),
    });
    expect(JSON.stringify(composeTimeline(input).timeline)).toBe(
      JSON.stringify(composeTimeline(input).timeline),
    );
  });
});
