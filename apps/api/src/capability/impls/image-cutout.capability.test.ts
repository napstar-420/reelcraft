import { describe, expect, it, vi } from 'vitest';
import { ImageCutoutCapability, cutoutSpec } from './image-cutout.capability';

const build = () => {
  const compute = {
    spawn: vi.fn().mockResolvedValue({ jobId: 'job-1', pid: 1 }),
    collect: vi.fn().mockResolvedValue('/jobs/job-1/cutout.png'),
  };
  return { compute, capability: new ImageCutoutCapability(compute as never) };
};

const ctx = (slots: Record<string, unknown>, config = {}) =>
  ({
    runId: 'r',
    stageKey: 'cutout',
    attemptNo: 1,
    config,
    slots,
    context: {},
    idempotencyKey: 'key',
    logger: { log: vi.fn(), error: vi.fn() },
  }) as never;

describe('cutoutSpec', () => {
  it('runs the worker in cutout mode on the picture, keeping its extension', () => {
    const spec = cutoutSpec({
      sourceKey: 'media/hero.webp',
      tolerance: 0.2,
      feather: 2,
      maxWaitSec: 60,
    });
    expect(spec.command).toBe(process.execPath);
    expect(spec.args.slice(1)).toEqual(['cutout', '{input:picture.webp}', '{output}', '0.2', '2']);
    expect(spec.inputs).toEqual([{ sourceKey: 'media/hero.webp', asFilename: 'picture.webp' }]);
    expect(spec.outputFilename).toBe('cutout.png');
  });
});

describe('ImageCutoutCapability', () => {
  it('cuts out the picture with the defaults and hands back a PNG', async () => {
    const { capability, compute } = build();
    const handle = await capability.submit(
      ctx({ image: { kind: 'media.image', sourceKey: 'media/a', filename: 'hero.png' } }),
    );
    const [, spec] = compute.spawn.mock.calls[0]!;
    expect(spec.args.slice(-2)).toEqual(['0.12', '1']);
    expect(spec.inputs[0].asFilename).toBe('picture.png');
    const result = await capability.fetch(handle);
    expect(result.output).toMatchObject({ kind: 'media.image', mime: 'image/png' });
    expect(result.costUsd).toBe(0);
  });

  it('needs a picture, and makes an image', async () => {
    const { capability } = build();
    await expect(capability.submit(ctx({}))).rejects.toThrow(/needs a picture/);
    expect(capability.validate({}, { output: { kind: 'media.video' } } as never)).toHaveLength(1);
    expect(capability.validate({}, { output: { kind: 'media.image' } } as never)).toEqual([]);
    expect(capability.slots()).toEqual([
      { name: 'image', accepts: ['media.image'], required: true, cardinality: 'one' },
    ]);
  });
});
