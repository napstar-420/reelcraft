import { describe, expect, it } from 'vitest';
import { Timeline } from './timeline';

const base = {
  version: 1 as const,
  canvas: { width: 1080, height: 1920, fps: 30 },
};

describe('Timeline', () => {
  it('accepts compatible media and overlay tracks', () => {
    expect(
      Timeline.parse({
        ...base,
        tracks: [
          {
            id: 'video',
            type: 'video',
            items: [{ type: 'media', handle: 'artifact:clip', startSec: 0, durationSec: 3 }],
          },
          {
            id: 'titles',
            type: 'overlay',
            items: [
              {
                type: 'text',
                text: 'Hello',
                startSec: 0,
                durationSec: 2,
                styleId: 'text.title',
                position: 'center',
              },
            ],
          },
        ],
      }).tracks,
    ).toHaveLength(2);
  });

  it('rejects duplicate tracks, incompatible items, missing duck targets, and excessive fades', () => {
    const parsed = Timeline.safeParse({
      ...base,
      tracks: [
        {
          id: 'same',
          type: 'video',
          items: [
            {
              type: 'media',
              handle: 'artifact:clip',
              startSec: 0,
              durationSec: 1,
              fadeInSec: 0.7,
              fadeOutSec: 0.7,
            },
          ],
        },
        {
          id: 'same',
          type: 'audio',
          duckUnder: 'missing',
          items: [
            {
              type: 'text',
              text: 'wrong track',
              startSec: 0,
              durationSec: 1,
              styleId: 'text.title',
              position: 'center',
            },
          ],
        },
      ],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.length).toBeGreaterThanOrEqual(4);
  });
});
