import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { Timeline } from '@reelcraft/shared';
import { timelineOutputSchema } from './timeline-output-schema';

describe('timelineOutputSchema', () => {
  const sample = {
    version: 1,
    canvas: { width: 1080, height: 1920, fps: 30 },
    tracks: [
      {
        id: 'v',
        type: 'video',
        items: [
          {
            type: 'media',
            handle: 'artifact:a',
            startSec: 0,
            durationSec: 3,
            motion: { type: 'ken_burns', intensity: 0.3 },
          },
        ],
      },
      { id: 'a', type: 'audio', items: [{ type: 'media', handle: 'artifact:b', startSec: 0 }] },
      {
        id: 'c',
        type: 'captions',
        items: [
          { type: 'captions', timingHandle: 'artifact:t', styleId: 'caption.clean', startSec: 0 },
        ],
      },
    ],
  };

  it('accepts a timeline the engine accepts', () => {
    expect(Timeline.safeParse(sample).success).toBe(true);
    const validate = new Ajv({ strict: false }).compile(timelineOutputSchema);
    expect(validate(sample), JSON.stringify(validate.errors)).toBe(true);
  });
});
