import { describe, expect, it, vi } from 'vitest';
import type { StageDef } from '@reelcraft/shared';
import type { BlenderRuntime } from '../../blender/blender-runtime.service';
import type { EngineConfig } from '../../config/engine-config';
import type { ComputeJobService } from '../../storage/compute-job.service';
import type { ExecCtx } from '../capability.interface';
import { SceneRenderCapability } from './scene-render.capability';

const scene = {
  engine: 'blender',
  contractVersion: 1,
  script: 'def build(rc):\n    pass\n',
  assets: [],
  width: 640,
  height: 360,
  fps: 24,
  durationSec: 1,
  transparent: false,
};

function setup() {
  const compute = {
    spawn: vi.fn(async () => ({ jobId: 'job', pid: 1, startedAt: 'now' })),
    collect: vi.fn(async () => '/w/jobs/job/scene.png'),
    cancel: vi.fn(async () => undefined),
    cleanup: vi.fn(async () => undefined),
  };
  const capability = new SceneRenderCapability(
    compute as unknown as ComputeJobService,
    { workspaceRoot: '/w' } as EngineConfig,
    { binary: async () => '/opt/blender/blender' } as unknown as BlenderRuntime,
  );
  return { capability, compute };
}

const ctx = (kind: string, config: Record<string, unknown> = {}) =>
  ({
    idempotencyKey: 'key',
    config,
    slots: { scene },
    resources: {},
    output: { kind },
  }) as unknown as ExecCtx<never>;

describe('SceneRenderCapability', () => {
  it('produces a clip, a still or a model, and nothing else', () => {
    const { capability } = setup();
    expect(capability.allowedOutputs()).toEqual(['media.video', 'media.model', 'media.image']);
    for (const kind of capability.allowedOutputs()) {
      expect(capability.validate({}, { output: { kind } } as StageDef)).toEqual([]);
    }
    expect(
      capability.validate({}, { output: { kind: 'audio.speech' } } as unknown as StageDef),
    ).toHaveLength(1);
  });

  it('renders a still at the moment asked for, with no frames to keep', async () => {
    const { capability, compute } = setup();
    const handle = await capability.submit(ctx('media.image', { frame: 1.5 }));
    const [, spec] = compute.spawn.mock.calls[0] as unknown as [
      string,
      { outputFilename: string; files: Array<{ asFilename: string; contents: string }> },
    ];
    expect(spec.outputFilename).toBe('scene.png');
    const job = JSON.parse(spec.files.find((f) => f.asFilename === 'job.json')!.contents);
    expect(job).toMatchObject({ mode: 'image', frame: 1.5 });
    expect(job).not.toHaveProperty('framesDir');

    const result = await capability.fetch(handle);
    expect(result.output).toMatchObject({
      kind: 'media.image',
      filename: 'scene.png',
      mime: 'image/png',
    });
    // Nothing was kept between attempts, so there is nothing to remove.
    await expect(capability.cleanup(handle)).resolves.toBeUndefined();
  });

  it('keeps rendering a clip frame by frame into a folder it removes afterwards', async () => {
    const { capability, compute } = setup();
    await capability.submit(ctx('media.video'));
    const [, spec] = compute.spawn.mock.calls[0] as unknown as [
      string,
      { outputFilename: string; files: Array<{ asFilename: string; contents: string }> },
    ];
    expect(spec.outputFilename).toBe('scene.mp4');
    const job = JSON.parse(spec.files.find((f) => f.asFilename === 'job.json')!.contents);
    expect(job.framesDir).toMatch(/^\/w\/jobs\/frames-/);
  });
});
