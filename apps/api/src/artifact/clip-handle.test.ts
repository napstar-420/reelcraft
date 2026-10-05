import { describe, expect, it } from 'vitest';
import { TimelineHandleService } from './timeline-handle.service';
import { clipHandle, parseArtifactHandle, storedClips } from './clip-handle';

describe('clip handles', () => {
  it('round-trips a clip handle and still reads a plain artifact handle', () => {
    expect(parseArtifactHandle(clipHandle('art1', 3))).toEqual({
      artifactId: 'art1',
      clipPosition: 3,
    });
    expect(parseArtifactHandle('artifact:art1')).toEqual({ artifactId: 'art1' });
    expect(parseArtifactHandle('asset:a1')).toBeUndefined();
    expect(parseArtifactHandle('artifact:art1#x')).toBeUndefined();
  });

  it('reads stored clips defensively', () => {
    expect(storedClips({ clips: [{ index: 1 }] })).toHaveLength(1);
    expect(storedClips(null)).toEqual([]);
    expect(storedClips({ clips: 'no' })).toEqual([]);
  });
});

describe('TimelineHandleService with a video list', () => {
  it("maps prev#i onto the list artifact's clip handles", () => {
    const timeline = {
      version: 1,
      canvas: { width: 1080, height: 1920, fps: 30, background: '#000000' },
      tracks: [
        {
          id: 'v',
          type: 'video',
          items: [
            {
              type: 'media',
              handle: 'prev#1',
              startSec: 0,
              durationSec: 2,
              fit: 'cover',
              overflow: 'trim',
            },
          ],
        },
      ],
    };
    const result = new TimelineHandleService().canonicalize(timeline, {
      clips: { ref: { from: 'prev' }, artifactId: 'art1', clipCount: 2 },
    }) as typeof timeline;
    expect(result.tracks[0]!.items[0]!.handle).toBe('artifact:art1#1');
  });
});
