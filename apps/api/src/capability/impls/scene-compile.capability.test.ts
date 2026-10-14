import { describe, expect, it, vi } from 'vitest';
import { Timeline } from '@reelcraft/shared';
import { fakeTimingFor } from '../../provider/fake/fake-timing';
import { WhiteboardAssetRegistry } from '../whiteboard/asset.registry';
import { SceneCompileCapability } from './scene-compile.capability';

const capability = new SceneCompileCapability(new WhiteboardAssetRegistry());

const plan = {
  version: 1,
  title: 'Habits',
  scenes: [
    {
      id: 'intro',
      template: 'title',
      title: 'Habits',
      narration: 'Habits run your day.',
      slots: [{ slot: 'main', asset: 'brain' }],
    },
    {
      id: 'loop',
      template: 'three_step',
      narration: 'Cue, then routine, then reward.',
      slots: [
        { slot: 'step1', asset: 'coffee-mug', text: 'Cue', cue: 'cue' },
        { slot: 'step2', asset: 'person-sitting', text: 'Routine', cue: 'routine' },
        { slot: 'step3', asset: 'trophy', text: 'Reward', cue: 'reward' },
      ],
    },
  ],
};
const timing = fakeTimingFor('Habits run your day. Cue, then routine, then reward.');

const ctxFor = (slots: Record<string, unknown>, config = {}, layer?: unknown) =>
  ({
    runId: 'run',
    stageKey: 'compile',
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

describe('SceneCompileCapability', () => {
  it('takes a plan, the voice-over, its timings and drawings, and makes a timeline', () => {
    expect(capability.slots().map((slot) => [slot.name, slot.required])).toEqual([
      ['scenes', true],
      ['voice', false],
      ['timing', false],
      ['assets', false],
    ]);
    expect(capability.allowedOutputs()).toEqual(['timeline']);
    expect(capability.modality).toBe('compute');
  });

  it('compiles a plan into a valid timeline at no cost', async () => {
    const result = await run({
      scenes: plan,
      voice: { handle: 'artifact:vo', durationSec: timing.durationSec, hasWordTiming: true },
      timing,
    });
    expect(result.costUsd).toBe(0);
    expect(result.modelError).toBeUndefined();
    const timeline = Timeline.parse(result.output);
    expect(timeline.version).toBe(2);
    expect(timeline.canvas).toMatchObject({ width: 1920, height: 1080, fps: 30 });
    expect(timeline.tracks.map((track) => track.id)).toEqual(['voice', 'drawings']);
    expect(await capability.estimateCost()).toMatchObject({ expectedUsd: 0, ceilingUsd: 0 });
  });

  it('follows the channel format, and its own settings over it', async () => {
    const layer = { format: { aspectRatio: '9:16', fps: 24 } };
    const tall = Timeline.parse((await run({ scenes: plan }, {}, layer)).output);
    expect(tall.canvas).toMatchObject({ width: 1080, height: 1920, fps: 24 });
    const own = Timeline.parse(
      (
        await run(
          { scenes: plan },
          { aspectRatio: '16:9', resolution: '720p', fps: 30, theme: 'chalkboard' },
          layer,
        )
      ).output,
    );
    expect(own.canvas).toMatchObject({ width: 1280, height: 720, fps: 30 });
    expect(own.theme).toMatchObject({ paper: '#243038' });
  });

  it('shows captions by the handle of whatever carries the word timings', async () => {
    const fromVoice = Timeline.parse(
      (
        await run(
          { scenes: plan, voice: { handle: 'artifact:vo', hasWordTiming: true }, timing },
          { captions: true, captionStyle: 'caption.bold_pop' },
        )
      ).output,
    );
    const captions = fromVoice.tracks.find((track) => track.type === 'captions')!;
    expect(captions.items[0]).toMatchObject({
      timingHandle: 'artifact:vo',
      styleId: 'caption.bold_pop',
    });

    const fromData = Timeline.parse(
      (
        await run(
          { scenes: plan, timing: { ...timing, handle: 'artifact:words' } },
          { captions: true },
        )
      ).output,
    );
    expect(fromData.tracks.find((track) => track.type === 'captions')!.items[0]).toMatchObject({
      timingHandle: 'artifact:words',
    });
  });

  it('says so when captions or timings are asked for but not there', async () => {
    const result = await run(
      { scenes: plan, voice: { handle: 'artifact:vo', hasWordTiming: true, durationSec: 5 } },
      { captions: true },
    );
    const codes = (result.providerMeta!.warnings as Array<{ code: string }>).map(
      (warning) => warning.code,
    );
    expect(codes).toContain('timing_missing');
    // The voice has word timings, so captions can still follow them.
    expect(codes).not.toContain('captions_skipped');
    const none = await run({ scenes: plan }, { captions: true });
    expect((none.providerMeta!.warnings as Array<{ code: string }>).map((w) => w.code)).toContain(
      'captions_skipped',
    );
  });

  it('reports what happened in the stage log', async () => {
    const ctx = ctxFor({ scenes: plan, timing });
    const result = await capability.fetch(await capability.submit(ctx), ctx);
    expect(result.providerMeta).toMatchObject({ scenes: [{ id: 'intro' }, { id: 'loop' }] });
  });

  it('stops with a clear message, without retrying, when the inputs are wrong', async () => {
    const badPlan = await run({ scenes: { ...plan, scenes: [] } });
    expect(badPlan.modelError).toMatchObject({ code: 'input_mismatch' });
    expect(badPlan.modelError!.message).toContain('the scene plan is not valid');

    const unknownSlot = await run({
      scenes: { ...plan, scenes: [{ ...plan.scenes[1]!, slots: [{ slot: 'step9', text: 'x' }] }] },
    });
    expect(unknownSlot.modelError!.message).toContain('step9');

    const badTiming = await run({ scenes: plan, timing: { words: 'nope' } });
    expect(badTiming.modelError!.message).toContain('word timings');

    const badAssets = await run({ scenes: plan, assets: { assets: [{ id: 'x' }] } });
    expect(badAssets.modelError!.message).toContain('set of drawings');
  });

  it('uses a drawing from the run over a built-in one', async () => {
    const result = await run({
      scenes: plan,
      assets: {
        assets: [
          {
            id: 'brain',
            label: 'Mine',
            viewBox: { width: 10, height: 10 },
            strokes: [{ d: 'M 1 1 L 9 9' }],
            source: 'generated',
          },
        ],
      },
    });
    const text = JSON.stringify(result.output);
    expect(text).toContain('"viewBox":{"width":10,"height":10}');
  });

  it('fails a plan with too many scenes for one canvas', async () => {
    const many = {
      ...plan,
      scenes: Array.from({ length: 40 }, (_, i) => ({
        id: `s${i}`,
        template: 'title',
        title: `Part ${i}`,
        narration: `Part ${i} here.`,
        slots: [{ slot: 'main', asset: 'star' }],
      })),
    };
    const result = await run({ scenes: many }, {}, { format: { aspectRatio: '9:16' } });
    expect(result.modelError).toMatchObject({ code: 'task_impossible' });
  });

  it('checks the stage', () => {
    const stage = (overrides: Record<string, unknown> = {}) =>
      ({ output: { kind: 'timeline' }, slots: {}, ...overrides }) as never;
    expect(capability.validate({}, stage())).toEqual([]);
    expect(capability.validate({}, stage({ output: { kind: 'text' } }))[0]).toMatchObject({
      path: 'output.kind',
    });
    expect(
      capability.validate({}, stage({ iterate: { over: { from: 'input', inputKey: 'x' } } }))[0],
    ).toMatchObject({ path: 'iterate' });
    expect(capability.validate({ captions: true }, stage())[0]).toMatchObject({
      path: 'config.captions',
    });
    expect(
      capability.validate({ captions: true }, stage({ slots: { voice: { from: 'prev' } } })),
    ).toEqual([]);
  });
});
