import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ComputeSpec, MotionSource } from '@reelcraft/shared';
import { SAMPLE_MOTION_CODE } from '../capability/motion/sample-motion';
import { MotionEditorService } from './motion-editor.service';

const graph = [
  { key: 'motion', capability: 'motion.generate' },
  { key: 'script', capability: 'text.generate' },
].map((stage) => ({
  label: stage.key,
  config: {},
  slots: {},
  context: {},
  checks: [],
  output: { kind: 'data', schema: { type: 'object' } },
  ...stage,
}));

const source: MotionSource = {
  version: 1,
  code: SAMPLE_MOTION_CODE,
  width: 640,
  height: 360,
  fps: 30,
  durationSec: 2,
  background: 'transparent',
  assets: [{ name: 'logo.png', handle: 'asset:a1' }],
};

function build(stillsDir?: string) {
  const db = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({ where: () => ({ limit: async () => [{ graph }] }) }),
      }),
    }),
  };
  const compute = {
    spawn: vi.fn(async (jobId: string, _spec: ComputeSpec) => ({ jobId, pid: 1 })),
    poll: vi.fn(async () => ({ done: true, outcome: 'succeeded' })),
    collect: vi.fn(async () => stillsDir),
    cleanup: vi.fn(async () => undefined),
  };
  const resources = {
    resolveHandles: vi.fn(async () => ({
      'asset:a1': { handle: 'asset:a1', kind: 'media.image', sourceKey: 'assets/logo' },
    })),
  };
  const service = new MotionEditorService(
    db as never,
    compute as never,
    resources as never,
    { remotionBrowserExecutable: '/b' } as never,
  );
  return { service, compute, resources };
}

describe('MotionEditorService', () => {
  it('checks code for a motion graphic stage, and refuses other stages', async () => {
    const { service } = build();
    expect((await service.check('r', 'motion', SAMPLE_MOTION_CODE)).issues).toEqual([]);
    const bad = await service.check('r', 'motion', 'export default () => Math.random();');
    expect(bad.issues.map((i) => i.code)).toEqual(['motion_nondeterministic']);
    await expect(service.check('r', 'script', 'x')).rejects.toThrow(/not a motion graphic stage/);
  });

  it('renders stills of the graphic with its own files, and hands them back once', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'motion-preview-'));
    await mkdir(dir, { recursive: true });
    for (const frame of [59, 0, 29])
      await writeFile(path.join(dir, `frame-${frame}.png`), `png${frame}`);
    const { service, compute, resources } = build(dir);

    const started = await service.startPreview('r', 'motion', source);
    expect(started.state).toBe('rendering');
    expect(resources.resolveHandles).toHaveBeenCalledWith('r', ['asset:a1']);
    const [jobId, spec] = compute.spawn.mock.calls[0]!;
    expect(jobId).toBe(started.id);
    expect(spec.args).toContain('--stills');
    expect(spec.inputs).toEqual([{ sourceKey: 'assets/logo', asFilename: 'logo.png' }]);

    const done = await service.preview('r', 'motion', started.id);
    expect(done.state).toBe('done');
    expect(done.stills?.map((s) => Buffer.from(s.split(',')[1]!, 'base64').toString())).toEqual([
      'png0',
      'png29',
      'png59',
    ]);
    expect(compute.cleanup).toHaveBeenCalledWith(started.id);
    // Read once: after that it is gone, and so is a preview of another run.
    expect((await service.preview('r', 'motion', started.id)).state).toBe('expired');
  });

  it('does not render code that breaks the rules, and reports a failed render', async () => {
    const { service, compute } = build();
    const invalid = await service.startPreview('r', 'motion', { ...source, code: "fetch('/x')" });
    expect(invalid.state).toBe('invalid');
    expect(compute.spawn).not.toHaveBeenCalled();

    compute.poll.mockResolvedValueOnce({ done: false } as never);
    const started = await service.startPreview('r', 'motion', source);
    expect((await service.preview('r', 'motion', started.id)).state).toBe('rendering');
    expect((await service.preview('other-run', 'motion', started.id)).state).toBe('expired');
    compute.poll.mockResolvedValueOnce({ done: true, outcome: 'failed', reason: 'boom' } as never);
    expect(await service.preview('r', 'motion', started.id)).toMatchObject({
      state: 'failed',
      error: 'boom',
    });
  });
});
