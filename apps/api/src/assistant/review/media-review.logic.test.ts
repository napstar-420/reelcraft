import { describe, expect, it } from 'vitest';
import { clampTimes, evenTimes, gridFor, parseAudioStats, timedLines } from './media-review.logic';

describe('media review helpers', () => {
  it('spreads frames evenly and keeps requested times inside the clip', () => {
    expect(evenTimes(10, 4)).toEqual([2, 4, 6, 8]);
    expect(evenTimes(0, 3)).toEqual([0]);
    expect(clampTimes([12, -1, 3, 3], 10)).toEqual([0, 3, 9.95]);
  });

  it('lays out a contact sheet', () => {
    expect(gridFor(1)).toEqual({ columns: 1, rows: 1 });
    expect(gridFor(4)).toEqual({ columns: 2, rows: 2 });
    expect(gridFor(6)).toEqual({ columns: 3, rows: 2 });
    expect(gridFor(7)).toEqual({ columns: 3, rows: 3 });
  });

  it("reads ffmpeg's volume and silence report, closing a trailing silence at the end", () => {
    const log = [
      '[Parsed_volumedetect_1 @ 0x1] mean_volume: -21.4 dB',
      '[Parsed_volumedetect_1 @ 0x1] max_volume: -1.2 dB',
      '[silencedetect @ 0x2] silence_start: 3.5',
      '[silencedetect @ 0x2] silence_end: 5.25 | silence_duration: 1.75',
      '[silencedetect @ 0x2] silence_start: 28.1',
    ].join('\n');
    expect(parseAudioStats(log, 30)).toEqual({
      meanVolumeDb: -21.4,
      maxVolumeDb: -1.2,
      silences: [
        { startSec: 3.5, endSec: 5.25 },
        { startSec: 28.1, endSec: 30 },
      ],
    });
    expect(parseAudioStats('')).toEqual({ meanVolumeDb: null, maxVolumeDb: null, silences: [] });
  });

  it('groups words into timed lines', () => {
    const words = [
      { text: 'Otters', startSec: 0.2, endSec: 0.6 },
      { text: 'hold', startSec: 0.7, endSec: 0.9 },
      { text: 'hands.', startSec: 1, endSec: 1.4 },
      { text: 'Really.', startSec: 7, endSec: 7.5 },
    ];
    expect(timedLines(words)).toEqual([
      { atSec: 0.2, text: 'Otters hold hands.' },
      { atSec: 7, text: 'Really.' },
    ]);
  });
});
