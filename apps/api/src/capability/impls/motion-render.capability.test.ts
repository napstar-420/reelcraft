import { describe, expect, it, vi } from 'vitest';
import type { MotionSource } from '@reelcraft/shared';
import { SAMPLE_MOTION_CODE } from '../motion/sample-motion';
import { MotionRenderCapability, motionRenderSpec } from './motion-render.capability';

const source: MotionSource = {
  version: 1,
  code: SAMPLE_MOTION_CODE,
  width: 1280,
  height: 720,
  fps: 30,
  durationSec: 3,
  background: 'transparent',
  props: { title: 'Hello' },
  assets: [{ name: 'logo.png', handle: 'artifact:a1' }],
};

const build = () => {
  const compute = {
    spawn: vi.fn().mockResolvedValue({ jobId: 'job-1', pid: 1 }),
    collect: vi.fn().mockResolvedValue('/jobs/job-1/motion.webm'),
  };
  const capability = new MotionRenderCapability(
    compute as never,
    { remotionBrowserExecutable: '/b' } as never,
  );
  return { compute, capability };
};

const ctx = (slots: Record<string, unknown>, resources = {}) =>
  ({
    runId: 'r',
    stageKey: 'render',
    attemptNo: 1,
    config: {},
    slots,
    context: {},
    resources,
    idempotencyKey: 'key',
    logger: { log: vi.fn(), error: vi.fn() },
  }) as never;

describe('motionRenderSpec', () => {
  it('runs the worker in motion mode with the source and its files', () => {
    const spec = motionRenderSpec({
      source,
      resources: { 'artifact:a1': { sourceKey: 'media/x.png' } },
      maxWaitSec: 60,
      browserExecutable: '/b',
    });
    expect(spec.args.slice(1)).toEqual(['motion', '{input:source.json}', '{output}', '/b']);
    expect(spec.inputs).toEqual([{ sourceKey: 'media/x.png', asFilename: 'logo.png' }]);
    expect(spec.outputFilename).toBe('motion.webm');
    expect(JSON.parse(spec.files![0]!.contents)).toMatchObject({
      width: 1280,
      props: { title: 'Hello' },
    });
  });

  it('renders an opaque graphic to MP4 and can render stills', () => {
    const spec = motionRenderSpec({
      source: { ...source, background: 'opaque', assets: [] },
      resources: {},
      maxWaitSec: 1,
      stills: true,
    });
    expect(spec.outputFilename).toBe('motion.mp4');
    expect(spec.args.at(-1)).toBe('--stills');
  });

  it('refuses a source whose files are missing', () => {
    expect(() => motionRenderSpec({ source, resources: {}, maxWaitSec: 1 })).toThrow(/logo\.png/);
  });
});

describe('MotionRenderCapability', () => {
  it('takes a motion graphic and makes a video', () => {
    const { capability } = build();
    expect(capability.slots().map((s) => s.name)).toEqual(['source']);
    expect(capability.allowedOutputs()).toEqual(['media.video']);
    expect(capability.validate({}, { output: { kind: 'data' } } as never)).toHaveLength(1);
  });

  it('spawns the render and hands back a transparent WebM', async () => {
    const { capability, compute } = build();
    const c = ctx(
      { source },
      { 'artifact:a1': { handle: 'artifact:a1', kind: 'media.image', sourceKey: 'k' } },
    );
    const handle = await capability.submit(c);
    expect(compute.spawn).toHaveBeenCalledWith(
      'key',
      expect.objectContaining({ outputFilename: 'motion.webm' }),
    );
    const result = await capability.fetch(handle, c);
    expect(result).toMatchObject({
      output: { kind: 'media.video', mime: 'video/webm', filename: 'motion.webm' },
      costUsd: 0,
    });
  });

  it('refuses code that breaks the rules before rendering', async () => {
    const { capability, compute } = build();
    const bad = {
      ...source,
      assets: [],
      code: "export default () => { fetch('/x'); return null; };",
    };
    await expect(capability.submit(ctx({ source: bad }))).rejects.toThrow(/fetch/);
    expect(compute.spawn).not.toHaveBeenCalled();
  });

  it('refuses something that is not a motion graphic', async () => {
    const { capability } = build();
    await expect(capability.submit(ctx({ source: { code: 'x' } }))).rejects.toThrow(
      /not a motion graphic/,
    );
  });
});
