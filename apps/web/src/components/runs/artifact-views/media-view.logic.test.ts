import { describe, expect, it } from 'vitest';
import { formatDuration, mediaFacts } from './media-view.logic';

describe('media view logic', () => {
  it('formats durations as m:ss and h:mm:ss', () => {
    expect(formatDuration(4.4)).toBe('0:04');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  it('lists video facts', () => {
    expect(
      mediaFacts('media.video', {
        container: 'mp4',
        durationSec: 30,
        streams: [
          { type: 'video', codec: 'h264', width: 1080, height: 1920, fps: 29.97 },
          { type: 'audio', codec: 'aac', sampleRate: 48000 },
        ],
      }),
    ).toEqual(['0:30', '1080×1920', '29.97 fps', 'With audio']);
  });

  it('flags silent video and skips duration for images', () => {
    const silent = {
      container: 'mp4',
      durationSec: 5,
      streams: [{ type: 'video' as const, codec: 'h264', width: 640, height: 360 }],
    };
    expect(mediaFacts('media.video', silent)).toContain('No audio');
    expect(mediaFacts('media.image', { ...silent, durationSec: 0 })).toEqual(['640×360']);
  });

  it('lists audio facts and handles a missing probe', () => {
    expect(
      mediaFacts('media.audio', {
        container: 'mp3',
        durationSec: 90,
        streams: [{ type: 'audio', codec: 'mp3', sampleRate: 44100 }],
      }),
    ).toEqual(['1:30', '44.1 kHz']);
    expect(mediaFacts('media.video', null)).toEqual([]);
  });
});
