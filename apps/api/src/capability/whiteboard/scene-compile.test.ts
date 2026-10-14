import { describe, expect, it } from 'vitest';
import { SceneSpec } from '@reelcraft/shared';
import type { TimelineItem, VectorAsset } from '@reelcraft/shared';
import { fakeTimingFor } from '../../provider/fake/fake-timing';
import { WhiteboardAssetRegistry } from './asset.registry';
import { compileScenes, SceneCompileError, type CompileInput } from './scene-compile';
import { WHITEBOARD_THEMES } from './themes';

type Sketch = Extract<TimelineItem, { type: 'sketch' }>;

const registry = new WhiteboardAssetRegistry();

const spec = SceneSpec.parse({
  version: 1,
  title: 'How habits work',
  assetNeeds: [
    {
      id: 'morning-mug',
      label: 'A steaming mug',
      description: 'A mug with steam',
      fallbackId: 'coffee-mug',
    },
  ],
  scenes: [
    {
      id: 'intro',
      template: 'title',
      title: 'How habits work',
      narration: 'Most habits happen without us thinking.',
      slots: [
        { slot: 'main', asset: 'brain' },
        { slot: 'subtitle', text: 'small changes, big results' },
      ],
    },
    {
      id: 'loop',
      template: 'cause_process_result',
      title: 'The habit loop',
      narration: 'First comes the cue. Then the routine. And finally the reward.',
      slots: [
        {
          slot: 'cause',
          asset: 'morning-mug',
          text: 'See a coffee mug',
          cue: 'first comes the cue',
        },
        {
          slot: 'process',
          asset: 'person-sitting',
          text: 'Make and drink coffee',
          cue: 'then the routine',
        },
        {
          slot: 'result',
          asset: 'person-celebrating',
          text: 'Feel more alert',
          emphasis: 'underline',
          cue: 'and finally the reward',
        },
      ],
    },
    {
      id: 'compare',
      template: 'before_after',
      narration: 'Before, you drift. After, you act on purpose.',
      slots: [
        { slot: 'before', asset: 'cloud', text: 'Drifting', emphasis: 'highlight' },
        { slot: 'after', asset: 'target', text: 'On purpose', emphasis: 'circle' },
      ],
    },
    {
      id: 'custom',
      template: 'free',
      narration: 'Keep it simple and consistent.',
      camera: 'wide',
      slots: [
        { slot: 'left', asset: 'checkmark', box: { x: 0.1, y: 0.2, w: 0.3, h: 0.5 } },
        { slot: 'right', text: 'Every day', box: { x: 0.5, y: 0.3, w: 0.4, h: 0.2 } },
      ],
    },
  ],
});

const script = spec.scenes.map((scene) => scene.narration).join(' ');
const timing = fakeTimingFor(script);

const base = (overrides: Partial<CompileInput> = {}): CompileInput => ({
  spec,
  canvas: { width: 1920, height: 1080, fps: 30 },
  theme: WHITEBOARD_THEMES.whiteboard,
  timing,
  voice: { handle: 'artifact:vo', durationSec: timing.durationSec },
  assets: new Map(),
  registry,
  hand: 'marker',
  ...overrides,
});

const sketches = (result: ReturnType<typeof compileScenes>): Sketch[] =>
  result.timeline.tracks
    .flatMap((track) => track.items)
    .filter((item): item is Sketch => item.type === 'sketch');

describe('compileScenes', () => {
  it('builds a valid version 2 timeline on one big canvas with a camera', () => {
    const { timeline } = compileScenes(base());
    expect(timeline.version).toBe(2);
    expect(timeline.theme).toMatchObject({ paper: '#fbfaf5' });
    // Four scenes: three across and two down, with a gap between.
    expect(timeline.world).toEqual({ width: 3 * 1920 + 2 * 230, height: 2 * 1080 + 130 });
    expect(timeline.camera!.keys[0]).toMatchObject({ atSec: 0, zoom: 1, cx: 960, cy: 540 });
    const times = timeline.camera!.keys.map((key) => key.atSec);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('moves the camera to each scene as it begins, and pulls back for a wide one', () => {
    const result = compileScenes(base());
    const keys = result.timeline.camera!.keys;
    const second = result.scenes[1]!;
    const arrive = keys.find((key) => key.atSec === second.startSec)!;
    expect(arrive).toMatchObject({ cx: 1920 + 230 + 960, cy: 540, zoom: 1, ease: 'in_out' });
    const last = keys[keys.length - 1]!;
    expect(last.cx).toBe(Math.round(result.timeline.world!.width / 2));
    expect(last.zoom).toBeLessThan(0.5);
  });

  it('times the scenes by the voice-over', () => {
    const result = compileScenes(base());
    // 6 words (2.4s), then 11 words, then 8 words, then 5 words, at 0.4s a word.
    expect(result.scenes.map((scene) => scene.startSec)).toEqual([0, 2.4, 6.8, 10]);
    expect(result.scenes[3]!.endSec).toBe(timing.durationSec);
  });

  it('starts a slot when its cue is spoken', () => {
    const result = compileScenes(base());
    const labels = Object.fromEntries(
      sketches(result)
        .filter((item) => item.id?.endsWith(':label'))
        .map((item) => [item.id, item]),
    );
    // "then the routine" begins at word 6 + 4: the cue's word time, less a little lead.
    const processCue = timing.words[6 + 4]!;
    const heading = sketches(result).find((item) => item.id === 'loop:process:heading')!;
    expect(heading.startSec).toBeCloseTo(processCue.startSec - 0.15, 1);
    expect(labels['loop:cause:label']!.cue).toEqual({
      timingHandle: 'artifact:vo',
      phrase: 'first comes the cue',
      offsetSec: -0.15,
    });
  });

  it('keeps everything inside its scene and nothing on top of anything else', () => {
    for (const canvas of [
      { width: 1920, height: 1080, fps: 30 },
      { width: 1080, height: 1920, fps: 30 },
    ]) {
      const result = compileScenes(base({ canvas }));
      const world = result.timeline.world!;
      const items = sketches(result);
      for (const item of items) {
        expect(item.x, item.id).toBeGreaterThanOrEqual(-canvas.width * 0.05);
        expect(item.y, item.id).toBeGreaterThanOrEqual(-canvas.height * 0.05);
        expect(item.x + item.w, item.id).toBeLessThanOrEqual(world.width + canvas.width * 0.05);
        expect(item.y + item.h, item.id).toBeLessThanOrEqual(world.height + canvas.height * 0.05);
      }
      // Drawings in one scene do not overlap.
      for (const scene of spec.scenes) {
        const assets = items.filter(
          (item) => item.id?.startsWith(`${scene.id}:`) && item.id.endsWith(':asset'),
        );
        for (let a = 0; a < assets.length; a += 1) {
          for (let b = a + 1; b < assets.length; b += 1) {
            const p = assets[a]!;
            const q = assets[b]!;
            const apart =
              p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y;
            expect(apart, `${p.id} overlaps ${q.id}`).toBe(true);
          }
        }
      }
    }
  });

  it('lays a sequence out in a row on a wide frame and a column on a tall one', () => {
    const find = (canvas: { width: number; height: number; fps: number }) => {
      const items = sketches(compileScenes(base({ canvas })));
      const asset = (name: string) => items.find((item) => item.id === `loop:${name}:asset`)!;
      return [asset('cause'), asset('process'), asset('result')];
    };
    const wide = find({ width: 1920, height: 1080, fps: 30 });
    expect(wide[0]!.x).toBeLessThan(wide[1]!.x);
    expect(wide[1]!.x).toBeLessThan(wide[2]!.x);
    expect(Math.abs(wide[0]!.y - wide[2]!.y)).toBeLessThan(1);
    const tall = find({ width: 1080, height: 1920, fps: 30 });
    expect(tall[0]!.y).toBeLessThan(tall[1]!.y);
    expect(tall[1]!.y).toBeLessThan(tall[2]!.y);
    expect(Math.abs(tall[0]!.x - tall[2]!.x)).toBeLessThan(1);
  });

  it('puts the scenes in one column on a tall frame', () => {
    const { timeline } = compileScenes(base({ canvas: { width: 1080, height: 1920, fps: 30 } }));
    expect(timeline.world).toEqual({ width: 1080, height: 4 * 1920 + 3 * 230 });
  });

  it('draws arrows between the places of a sequence, and not before the first', () => {
    const items = sketches(compileScenes(base()));
    expect(items.some((item) => item.id === 'loop:cause:connector')).toBe(false);
    expect(items.some((item) => item.id === 'loop:process:connector')).toBe(true);
    expect(items.some((item) => item.id === 'loop:result:connector')).toBe(true);
    const tall = sketches(compileScenes(base({ canvas: { width: 1080, height: 1920, fps: 30 } })));
    expect(tall.find((item) => item.id === 'loop:process:connector')!.rotate).toBe(90);
  });

  it('keeps items on the screen until the video ends, so the drawing builds up', () => {
    const result = compileScenes(base());
    const end = Math.max(...sketches(result).map((item) => item.startSec + item.durationSec));
    for (const item of sketches(result)) {
      expect(item.startSec + item.durationSec).toBeCloseTo(end, 1);
    }
  });

  it('adds the voice-over and the captions as tracks', () => {
    const result = compileScenes(
      base({ captions: { handle: 'artifact:vo', styleId: 'caption.clean' } }),
    );
    const tracks = result.timeline.tracks;
    expect(tracks.map((track) => track.id)).toEqual(['voice', 'drawings', 'captions']);
    expect(tracks[0]!.items[0]).toMatchObject({
      type: 'media',
      handle: 'artifact:vo',
      startSec: 0,
    });
    expect(tracks[2]!.items[0]).toMatchObject({ type: 'captions', timingHandle: 'artifact:vo' });
    const plain = compileScenes(base({ voice: undefined, timing: undefined }));
    expect(plain.timeline.tracks.map((track) => track.id)).toEqual(['drawings']);
  });

  it('works without a voice-over, timing scenes by how long they take to read', () => {
    const result = compileScenes(base({ voice: undefined, timing: undefined }));
    expect(result.scenes[0]!.startSec).toBe(0);
    expect(result.scenes[1]!.startSec).toBeGreaterThanOrEqual(2);
    // Every cue falls back to order, with a warning.
    expect(result.warnings.filter((w) => w.code === 'cue_unresolved')).toHaveLength(3);
  });

  describe('drawings', () => {
    it('uses a drawing this run made over a built-in one with the same id', () => {
      const made: VectorAsset = {
        id: 'brain',
        label: 'My brain',
        viewBox: { width: 50, height: 50 },
        strokes: [{ d: 'M 5 5 L 45 45' }],
        source: 'generated',
      };
      const items = sketches(compileScenes(base({ assets: new Map([['brain', made]]) })));
      const brain = items.find((item) => item.id === 'intro:main:asset')!;
      expect(brain.content).toMatchObject({ kind: 'paths', viewBox: { width: 50, height: 50 } });
    });

    it('falls back to the built-in drawing a plan names, with a warning', () => {
      const result = compileScenes(base());
      const warning = result.warnings.find(
        (w) => w.code === 'asset_fallback' && w.slot === 'cause',
      )!;
      expect(warning.message).toContain('coffee-mug');
      const mug = sketches(result).find((item) => item.id === 'loop:cause:asset')!;
      expect(mug.content).toMatchObject({ kind: 'paths' });
    });

    it('finds the closest built-in drawing when there is no named fallback, or draws a star', () => {
      const odd = SceneSpec.parse({
        version: 1,
        title: 'x',
        scenes: [
          {
            id: 'one',
            template: 'title',
            title: 'Hello',
            narration: 'Hello there.',
            slots: [{ slot: 'main', asset: 'bright-idea', text: undefined, heading: undefined }],
          },
          {
            id: 'two',
            template: 'title',
            title: 'Again',
            narration: 'Again now.',
            slots: [{ slot: 'main', asset: 'zzqx-plugh' }],
          },
        ],
      });
      const result = compileScenes(base({ spec: odd, timing: undefined, voice: undefined }));
      expect(result.warnings.find((w) => w.scene === 'one')!.message).toContain('lightbulb');
      expect(result.warnings.find((w) => w.scene === 'two')!.code).toBe('asset_missing');
    });
  });

  it('warns when words are too long for their place', () => {
    const long = SceneSpec.parse({
      version: 1,
      title: 'x',
      scenes: [
        {
          id: 'one',
          template: 'free',
          narration: 'Before and after.',
          slots: [
            {
              slot: 'tiny',
              text: 'Far too many words here',
              box: { x: 0.1, y: 0.1, w: 0.04, h: 0.02 },
            },
          ],
        },
      ],
    });
    const result = compileScenes(base({ spec: long, timing: undefined, voice: undefined }));
    expect(result.warnings.some((w) => w.code === 'text_overflow' && w.slot === 'tiny')).toBe(true);
  });

  it('refuses a plan with too many scenes for one canvas', () => {
    const many = SceneSpec.parse({
      version: 1,
      title: 'long',
      scenes: Array.from({ length: 40 }, (_, i) => ({
        id: `s${i}`,
        template: 'title',
        title: `Part ${i}`,
        narration: `Part number ${i}.`,
        slots: [{ slot: 'main', asset: 'star' }],
      })),
    });
    expect(() =>
      compileScenes(
        base({
          spec: many,
          canvas: { width: 1080, height: 1920, fps: 30 },
          timing: undefined,
          voice: undefined,
        }),
      ),
    ).toThrowError(SceneCompileError);
  });

  it('gives the same timeline every time', () => {
    expect(JSON.stringify(compileScenes(base()))).toBe(JSON.stringify(compileScenes(base())));
  });
});
