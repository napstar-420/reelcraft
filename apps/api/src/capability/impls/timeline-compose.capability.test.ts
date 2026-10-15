import { describe, expect, it, vi } from 'vitest';
import { Timeline } from '@reelcraft/shared';
import { fakeTimingFor } from '../../provider/fake/fake-timing';
import { TimelineComposeCapability } from './timeline-compose.capability';

const capability = new TimelineComposeCapability();

const plan = {
  version: 1,
  layers: [
    { kind: 'audio', asset: 'audio-1', track: 'voice' },
    {
      kind: 'image',
      asset: 'image-1',
      x: 0.1,
      y: 0.1,
      w: 0.5,
      h: 0.5,
      atCue: 'a trail',
      anim: 'pop',
    },
    { kind: 'captions' },
  ],
};
const timing = { ...fakeTimingFor('Every dollar leaves a trail.'), handle: 'memory:timing' };
const media = [
  { handle: 'artifact:voice', kind: 'media.audio', probe: { durationSec: 2 } },
  { handle: 'artifact:photo', kind: 'media.image' },
];

const ctxFor = (slots: Record<string, unknown>, config = {}, layer?: unknown) =>
  ({
    runId: 'run',
    stageKey: 'compose',
    attemptNo: 1,
    config,
    slots,
    context: {},
    idempotencyKey: 'key',
    layer,
    logger: { log: vi.fn(), error: vi.fn() },
  }) as never;

const run = async (slots: Record<string, unknown>, config = {}, layer?: unknown) => {
  const ctx = ctxFor(slots, config, layer);
  const handle = await capability.submit(ctx);
  expect(await capability.poll()).toMatchObject({ done: true, outcome: 'succeeded' });
  return capability.fetch(handle, ctx);
};

describe('TimelineComposeCapability', () => {
  it('takes a plan, any assets and word timings, and makes a timeline', () => {
    expect(capability.slots().map((slot) => [slot.name, slot.required, slot.cardinality])).toEqual([
      ['plan', true, 'one'],
      ['assets', false, 'many'],
      ['timing', false, 'one'],
    ]);
    expect(capability.allowedOutputs()).toEqual(['timeline']);
    expect(capability.modality).toBe('compute');
  });

  it('composes the plan at no cost, with captions following the timings', async () => {
    const result = await run({ plan, assets: media, timing });
    expect(result.costUsd).toBe(0);
    expect(result.modelError).toBeUndefined();
    const timeline = Timeline.parse(result.output);
    expect(timeline.canvas).toMatchObject({ width: 1920, height: 1080, fps: 30 });
    expect(timeline.tracks.map((track) => track.type)).toEqual(['overlay', 'captions', 'audio']);
    const captions = timeline.tracks.find((track) => track.type === 'captions')!;
    expect(captions.items[0]).toMatchObject({ timingHandle: 'memory:timing' });
    expect(await capability.estimateCost()).toMatchObject({ expectedUsd: 0, ceilingUsd: 0 });
  });

  it('follows the channel format, and its own settings over it', async () => {
    const layer = { format: { aspectRatio: '9:16', fps: 24 } };
    const tall = Timeline.parse((await run({ plan, assets: media, timing }, {}, layer)).output);
    expect(tall.canvas).toMatchObject({ width: 1080, height: 1920, fps: 24 });
    const own = Timeline.parse(
      (
        await run(
          { plan, assets: media, timing },
          { aspectRatio: '16:9', resolution: '720p', fps: 30, theme: { paper: '#243038' } },
          layer,
        )
      ).output,
    );
    expect(own.canvas).toMatchObject({ width: 1280, height: 720, fps: 30 });
  });

  it('hands a plan problem back to the model, all of it', async () => {
    const result = await run({
      plan: { version: 1, layers: [{ kind: 'image', asset: 'nope' }, { kind: 'text' }] },
      assets: media,
    });
    expect(result.modelError).toMatchObject({ code: 'task_impossible' });
    expect(result.modelError!.message).toContain('no image asset "nope". Available: image-1');
    expect(result.modelError!.message).toContain('needs text');
  });

  it('says so when the plan, the timings or an input is the wrong shape', async () => {
    expect((await run({ plan: { version: 2, layers: [] } })).modelError?.message).toContain(
      'the plan is not valid',
    );
    expect(
      (await run({ plan, assets: media, timing: { words: 'x' } })).modelError?.message,
    ).toContain('not word timings');
    expect((await run({ plan, assets: [{ nope: true }] })).modelError?.message).toContain(
      'not an asset',
    );
  });

  it('takes more asset inputs by the names its settings give, and calls each file by its slot', async () => {
    expect(capability.slots({ inputs: ['voice', 'photos'] }).map((slot) => slot.name)).toEqual([
      'plan',
      'assets',
      'voice',
      'photos',
      'timing',
    ]);
    const result = await run(
      {
        plan: {
          version: 1,
          layers: [
            { kind: 'audio', asset: 'voice' },
            { kind: 'image', asset: 'photos-2', x: 0, y: 0, w: 1, h: 1 },
          ],
        },
        voice: media[0],
        photos: [
          { handle: 'artifact:p#0', kind: 'media.image' },
          { handle: 'artifact:p#1', kind: 'media.image' },
        ],
      },
      { inputs: ['voice', 'photos'] },
    );
    expect(result.modelError).toBeUndefined();
    const timeline = Timeline.parse(result.output);
    expect(timeline.tracks.find((track) => track.type === 'overlay')!.items[0]).toMatchObject({
      handle: 'artifact:p#1',
    });
  });

  it('refuses an input name that clashes with a slot', () => {
    const issues = capability.validate({ inputs: ['plan', 'Bad Name', 'ok'] }, {
      key: 'c',
      label: 'c',
      capability: 'timeline.compose',
      config: {},
      slots: {},
      context: {},
      output: { kind: 'timeline' },
      checks: [],
    } as never);
    expect(issues.filter((issue) => issue.path === 'config.inputs')).toHaveLength(2);
  });

  it('refuses to iterate or to make anything but a timeline', () => {
    const issues = capability.validate({}, {
      key: 'c',
      label: 'c',
      capability: 'timeline.compose',
      config: {},
      slots: {},
      context: {},
      output: { kind: 'data', schema: { type: 'object' } },
      iterate: { over: { from: 'const', value: [] } },
      checks: [],
    } as never);
    expect(issues.map((issue) => issue.path)).toEqual(['output.kind', 'iterate']);
  });
});
