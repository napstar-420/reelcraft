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

  describe('targets', () => {
    const still = { artifact: { kind: 'media.image', probe: null, data: null }, blob: null };

    it('points a missing file at the clip that uses it', async () => {
      const results = await serviceWith([{ assets: {} }], []).run({
        runId: 'r1',
        timeline: timeline('artifact:GONE'),
      });
      expect(results.find((r) => r.name === 'timeline.handles_resolve')?.targets).toEqual([
        { trackId: 'video-main', itemIndex: 0 },
      ]);
    });

    it('points a clip that runs past its source at that clip', async () => {
      const results = await serviceWith(
        [{ assets: {} }],
        [{ artifact: { kind: 'media.video', probe: { durationSec: 2 }, data: null }, blob: null }],
      ).run({ runId: 'r1', timeline: timeline('artifact:V') });
      expect(results.find((r) => r.name === 'timeline.source_bounds')?.targets).toEqual([
        { trackId: 'video-main', itemIndex: 0 },
      ]);
    });

    it('points a gap at the clips on either side of it', async () => {
      const gapped = {
        version: 1,
        canvas: { width: 1080, height: 1920, fps: 30 },
        tracks: [
          {
            id: 'video-main',
            type: 'video',
            items: [
              { type: 'media', handle: 'artifact:A', startSec: 0, durationSec: 2 },
              { type: 'media', handle: 'artifact:B', startSec: 4, durationSec: 2 },
            ],
          },
        ],
      };
      const results = await serviceWith([{ assets: {} }], [still], [still]).run({
        runId: 'r1',
        timeline: gapped,
      });
      const coverage = results.find((r) => r.name === 'timeline.coverage');
      expect(coverage?.pass).toBe(false);
      expect(coverage?.targets).toEqual([
        { trackId: 'video-main', itemIndex: 0 },
        { trackId: 'video-main', itemIndex: 1 },
      ]);
    });

    it('has no targets when everything passes', async () => {
      const results = await serviceWith([{ assets: {} }], [still]).run({
        runId: 'r1',
        timeline: timeline('artifact:A'),
      });
      expect(results.every((r) => r.targets === undefined)).toBe(true);
    });
  });
});
