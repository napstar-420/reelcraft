import { describe, expect, it } from 'vitest';
import { TimelineCheckService } from './timeline-check.service';

/** Each query ending in `.limit()` resolves to the next queued result. */
function serviceWith(...results: unknown[][]): TimelineCheckService {
  const queue = [...results];
  const query: Record<string, unknown> = {};
  for (const method of ['from', 'leftJoin', 'where']) query[method] = () => query;
  query.limit = () => Promise.resolve(queue.shift() ?? []);
  const db = { select: () => query };
  return new TimelineCheckService(db as never, { has: () => true } as never);
}

const timeline = (handle: string, overflow: 'trim' | 'loop' = 'trim') => ({
  version: 1,
  canvas: { width: 1080, height: 1920, fps: 30 },
  tracks: [
    {
      id: 'video-main',
      type: 'video',
      items: [{ type: 'media', handle, startSec: 0, durationSec: 5, overflow }],
    },
  ],
});

const imageList = {
  artifact: {
    kind: 'media.image_list',
    probe: null,
    data: {
      images: [
        { index: 0, blobId: 'b0', probe: { durationSec: 0 } },
        { index: 1, blobId: 'b1', probe: { durationSec: 0 } },
      ],
    },
  },
  blob: null,
};

describe('TimelineCheckService media handles', () => {
  it('resolves an item of an image list, and a still has no source length to exceed', async () => {
    const results = await serviceWith(
      [{ assets: {} }],
      [imageList],
      [{ id: 'b1', deletedAt: null, probe: { durationSec: 0 } }],
    ).run({ runId: 'r1', timeline: timeline('artifact:A#1') });
    expect(results.find((r) => r.name === 'timeline.handles_resolve')?.pass).toBe(true);
    expect(results.find((r) => r.name === 'timeline.source_bounds')?.pass).toBe(true);
  });

  it('fails an item position the list does not have', async () => {
    const results = await serviceWith([{ assets: {} }], [imageList]).run({
      runId: 'r1',
      timeline: timeline('artifact:A#7'),
    });
    expect(results.find((r) => r.name === 'timeline.handles_resolve')).toMatchObject({
      pass: false,
      message: 'artifact:A#7 is missing, stale, or deleted',
    });
  });

  it('fails an item whose file was deleted', async () => {
    const results = await serviceWith(
      [{ assets: {} }],
      [imageList],
      [{ id: 'b1', deletedAt: '2026-10-01', probe: null }],
    ).run({ runId: 'r1', timeline: timeline('artifact:A#1') });
    expect(results.find((r) => r.name === 'timeline.handles_resolve')?.pass).toBe(false);
  });

  it('still rejects video that runs past its source', async () => {
    const results = await serviceWith(
      [{ assets: {} }],
      [{ artifact: { kind: 'media.video', probe: { durationSec: 2 }, data: null }, blob: null }],
    ).run({ runId: 'r1', timeline: timeline('artifact:V') });
    expect(results.find((r) => r.name === 'timeline.source_bounds')?.pass).toBe(false);
  });

  it('rejects a handle that is not canonical', async () => {
    const results = await serviceWith([{ assets: {} }]).run({
      runId: 'r1',
      timeline: timeline('words'),
    });
    expect(results.find((r) => r.name === 'timeline.handles_resolve')).toMatchObject({
      pass: false,
      message: 'words is not canonical',
    });
  });
});
