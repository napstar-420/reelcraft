import { describe, expect, it } from 'vitest';
import { TimelineHandleService } from './timeline-handle.service';

describe('TimelineHandleService.canonicalize', () => {
  const timeline = (handle: string) => ({
    version: 1,
    canvas: { width: 1080, height: 1920, fps: 30 },
    tracks: [{ id: 'v', type: 'video', items: [{ type: 'media', handle, startSec: 0 }] }],
  });
  const provenance = {
    images: { ref: { from: 'memory', key: 'scene_images' }, artifactIds: ['A0', 'A1'] },
  } as never;
  const handleOf = (value: unknown) =>
    (value as { tracks: [{ items: [{ handle: string }] }] }).tracks[0].items[0].handle;

  it('maps relative handles and bare artifact ids to artifact:<id>', () => {
    const service = new TimelineHandleService();
    expect(handleOf(service.canonicalize(timeline('memory:scene_images#1'), provenance))).toBe(
      'artifact:A1',
    );
    expect(handleOf(service.canonicalize(timeline('A0'), provenance))).toBe('artifact:A0');
  });
});
