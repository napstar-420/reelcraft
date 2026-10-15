import { describe, expect, it, vi } from 'vitest';
import { Timeline } from '@reelcraft/shared';
import { BuiltinDrawings } from '../vector/builtin-drawings';
import { drawingPreviewSpec, SvgPreviewCapability } from './svg-preview.capability';

const registry = new BuiltinDrawings();
const assets = registry
  .list()
  .slice(0, 6)
  .map(({ tags: _tags, ...asset }) => asset);

const build = () => {
  const compute = {
    spawn: vi.fn().mockResolvedValue({ jobId: 'job-1', pid: 1 }),
    collect: vi.fn().mockResolvedValue('/jobs/job-1/drawings.png'),
  };
  const capability = new SvgPreviewCapability(
    compute as never,
    {
      remotionBrowserExecutable: '/usr/bin/headless-shell',
    } as never,
  );
  return { compute, capability };
};

const ctx = (slots: Record<string, unknown>, config = {}) =>
  ({
    runId: 'r',
    stageKey: 'preview',
    attemptNo: 1,
    config,
    slots,
    context: {},
    idempotencyKey: 'key',
    logger: { log: vi.fn(), error: vi.fn() },
  }) as never;

describe('drawingPreviewSpec', () => {
  it('renders the contact sheet with the worker in still mode', () => {
    const spec = drawingPreviewSpec({
      assets,
      columns: 3,
      maxWaitSec: 120,
      browserExecutable: '/b',
    });
    expect(spec.args.slice(1)).toEqual([
      '{input:timeline.json}',
      '{input:resources.json}',
      'still',
      '{output}',
      '/b',
    ]);
    expect(spec.outputFilename).toBe('drawings.png');
    expect(spec.maxWaitSec).toBe(120);
    const timeline = Timeline.parse(
      JSON.parse(spec.files!.find((f) => f.asFilename === 'timeline.json')!.contents),
    );
    expect(timeline.canvas).toMatchObject({ width: 3 * 320, height: 2 * 340 });
  });

  it('leaves out the browser when none is set', () => {
    expect(drawingPreviewSpec({ assets, columns: 3, maxWaitSec: 1 }).args).toHaveLength(5);
  });
});

describe('SvgPreviewCapability', () => {
  it('takes a set of drawings and makes an image', () => {
    const { capability } = build();
    expect(capability.slots().map((slot) => [slot.name, slot.required])).toEqual([
      ['assets', true],
    ]);
    expect(capability.allowedOutputs()).toEqual(['media.image']);
    expect(capability.modality).toBe('compute');
  });

  it('spawns the render for the stage attempt, and hands back the picture', async () => {
    const { capability, compute } = build();
    const handle = await capability.submit(ctx({ assets: { assets } }, { columns: 2 }));
    expect(compute.spawn).toHaveBeenCalledWith(
      'key',
      expect.objectContaining({ outputFilename: 'drawings.png' }),
    );
    expect(handle).toMatchObject({ providerId: 'local-compute', externalId: 'job-1' });
    const result = await capability.fetch(handle);
    expect(result).toMatchObject({
      output: { kind: 'media.image', localPath: '/jobs/job-1/drawings.png', mime: 'image/png' },
      costUsd: 0,
    });
    expect(await capability.estimateCost()).toMatchObject({ ceilingUsd: 0 });
  });

  it('rejects something that is not a set of drawings', async () => {
    const { capability } = build();
    await expect(capability.submit(ctx({ assets: { assets: [{ id: 'x' }] } }))).rejects.toThrow();
  });

  it('checks the stage', () => {
    const { capability } = build();
    expect(capability.validate({}, { output: { kind: 'media.image' } } as never)).toEqual([]);
    expect(capability.validate({}, { output: { kind: 'text' } } as never)[0]).toMatchObject({
      path: 'output.kind',
    });
  });
});
