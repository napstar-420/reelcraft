import { describe, expect, it, vi } from 'vitest';
import { MotionSource } from '@reelcraft/shared';
import { SAMPLE_MOTION_CODE } from '../motion/sample-motion';
import { MotionGenerateCapability, motionFrame } from './motion-generate.capability';

const build = (
  output: unknown = {
    status: 'ok',
    message: '',
    result: { code: SAMPLE_MOTION_CODE, durationSec: 4, notes: 'A title.' },
  },
) => {
  const adapter = {
    estimate: vi
      .fn()
      .mockResolvedValue({ expectedUsd: 0, ceilingUsd: 0, basis: 'configured_ceiling' }),
    submit: vi.fn().mockResolvedValue({ providerId: 'fake', externalId: 'j1' }),
    poll: vi.fn().mockResolvedValue({ done: true, outcome: 'succeeded' }),
    fetch: vi.fn().mockResolvedValue({ output, costUsd: 0.01, repro: { level: 'none' } }),
    cancel: vi.fn(),
  };
  const providers = { get: vi.fn().mockReturnValue(adapter) };
  return {
    adapter,
    capability: new MotionGenerateCapability(
      providers as never,
      { remotionBrowserExecutable: '/b' } as never,
    ),
  };
};

const ctx = (config: Record<string, unknown> = {}, slots: Record<string, unknown> = {}) =>
  ({
    runId: 'r',
    stageKey: 'motion',
    attemptNo: 1,
    config: { provider: 'fake', modelId: 'fake-text-1', ...config },
    slots,
    context: {},
    renderedPrompt: 'An animated bar chart of the sales.',
    idempotencyKey: 'key',
    logger: { log: vi.fn(), error: vi.fn() },
  }) as never;

describe('motionFrame', () => {
  it('takes the size from the config, then the canvas, then 1920x1080', () => {
    expect(motionFrame(ctx()).base).toMatchObject({
      width: 1920,
      height: 1080,
      fps: 30,
      background: 'transparent',
    });
    const canvas = { version: 1, canvas: { width: 1080, height: 1920, fps: 25 }, tracks: [] };
    expect(motionFrame(ctx({}, { canvas })).base).toMatchObject({
      width: 1080,
      height: 1920,
      fps: 25,
    });
    expect(motionFrame(ctx({ width: 640, background: 'opaque' }, { canvas })).base).toMatchObject({
      width: 640,
      height: 1920,
      background: 'opaque',
    });
  });

  it('passes the data as props and the images as files', () => {
    const { base } = motionFrame(
      ctx(
        {},
        {
          data: { values: [1, 2] },
          assets: [
            { kind: 'media.image', handle: 'artifact:a', name: 'logo' },
            { kind: 'media.audio', handle: 'artifact:b' },
          ],
        },
      ),
    );
    expect(base.props).toEqual({ values: [1, 2] });
    expect(base.assets).toEqual([{ name: 'logo.png', handle: 'artifact:a' }]);
  });

  it('passes library fonts by family, not as files to load', () => {
    const { base } = motionFrame(
      ctx(
        {},
        {
          assets: {
            assets: [
              { id: 'gochi', kind: 'font', handle: 'asset:f1', family: 'Gochi Hand' },
              { id: 'photo', kind: 'image', handle: 'asset:p1' },
            ],
          },
        },
      ),
    );
    expect(base.fonts).toEqual([{ name: 'font-gochi', handle: 'asset:f1', family: 'Gochi Hand' }]);
    expect(base.assets).toEqual([{ name: 'photo.png', handle: 'asset:p1' }]);
  });
});

describe('MotionGenerateCapability', () => {
  it('asks a text model, with the rules and this graphic described', async () => {
    const { capability, adapter } = build();
    await capability.submit(ctx({ durationSec: 6, style: 'bold blue' }, { data: { values: [3] } }));
    const [req] = adapter.submit.mock.calls[0]!;
    expect(req.modality).toBe('text');
    expect(req.system).toContain('useCurrentFrame');
    expect(req.renderedPrompt).toContain('An animated bar chart');
    expect(req.renderedPrompt).toContain('Length: 6 seconds');
    expect(req.renderedPrompt).toContain('Style: bold blue');
    expect(req.renderedPrompt).toContain('"values"');
    expect(req.output.kind).toBe('data');
    expect(req.params.__allowedCommands).toEqual(['node check.mjs']);
    expect(req.params.__workspaceInstructions).toContain('node check.mjs run');
    const files = req.params.__workspace.files as Array<{ path: string; contents: string }>;
    expect(files.map((f) => f.path)).toEqual(['GUIDE.md', 'Motion.tsx', 'check.mjs', 'kit.json']);
    const kit = JSON.parse(files.find((f) => f.path === 'kit.json')!.contents);
    expect(kit).toMatchObject({
      durationSec: 6,
      props: { values: [3] },
      browser: '/b',
      frame: { width: 1920 },
    });
    expect(kit.checker).toMatch(/motion-code-check\.js$/);
    expect(req.renderedPrompt).not.toContain('Fonts you can use');
    expect(capability.modality).toBe('text');
  });

  it('turns the answer into a motion graphic', async () => {
    const { capability } = build();
    const result = await capability.fetch(
      { providerId: 'fake', externalId: 'j1' },
      ctx({}, { data: { title: 'Hi' } }),
    );
    const source = MotionSource.parse(result.output);
    expect(source).toMatchObject({
      durationSec: 4,
      width: 1920,
      props: { title: 'Hi' },
      notes: 'A title.',
    });
    expect(result.costUsd).toBe(0.01);
  });

  it('keeps the length the stage set over the model', async () => {
    const { capability } = build();
    const result = await capability.fetch(
      { providerId: 'fake', externalId: 'j1' },
      ctx({ durationSec: 2 }),
    );
    expect((result.output as MotionSource).durationSec).toBe(2);
  });

  it('rejects an answer that is not a motion graphic, and passes on a model error', async () => {
    expect(
      (
        await build({ status: 'ok', message: '', result: { nope: 1 } }).capability.fetch(
          { providerId: 'fake', externalId: 'j' },
          ctx(),
        )
      ).rejection,
    ).toMatch(/not a motion graphic/);
    const declined = await build({ status: 'refused', message: 'no', result: {} }).capability.fetch(
      { providerId: 'fake', externalId: 'j' },
      ctx(),
    );
    expect(declined.modelError).toMatchObject({ message: 'no' });
  });

  it('checks the stage: data output, and warns without the motion_code check', () => {
    const { capability } = build();
    expect(
      capability
        .validate({} as never, { output: { kind: 'text' }, checks: [] } as never)
        .map((i) => i.severity),
    ).toEqual(['error', 'warning']);
    expect(
      capability.validate(
        {} as never,
        { output: { kind: 'data' }, checks: [{ type: 'builtin', key: 'motion_code' }] } as never,
      ),
    ).toEqual([]);
  });

  it('tells the model which fonts it can name', async () => {
    const { capability, adapter } = build();
    await capability.submit(
      ctx(
        {},
        {
          assets: {
            assets: [{ id: 'gochi', kind: 'font', handle: 'asset:f1', family: 'Gochi Hand' }],
          },
        },
      ),
    );
    const [req] = adapter.submit.mock.calls[0]!;
    expect(req.renderedPrompt).toContain('Fonts you can use by name');
    expect(req.renderedPrompt).toContain("'Gochi Hand'");
    const files = req.params.__workspace.files as Array<{ path: string; contents: string }>;
    expect(files.find((f) => f.path === 'GUIDE.md')!.contents).toContain('fallback font');
  });
});
