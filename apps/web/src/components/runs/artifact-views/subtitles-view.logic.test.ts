import { describe, expect, it } from 'vitest';
import { formatCueTime, parseSubtitles } from './subtitles-view.logic';

describe('subtitles view logic', () => {
  it('parses SRT cues, including multi-line text and CRLF', () => {
    const srt =
      '1\r\n00:00:01,500 --> 00:00:03,000\r\nHello there\r\n\r\n2\r\n00:01:02,000 --> 00:01:04,250\r\nTwo\r\nlines\r\n';
    expect(parseSubtitles(srt)).toEqual([
      { startSec: 1.5, endSec: 3, text: 'Hello there' },
      { startSec: 62, endSec: 64.25, text: 'Two\nlines' },
    ]);
  });

  it('parses VTT cues, skipping the header, notes, and cue settings', () => {
    const vtt =
      'WEBVTT\n\nNOTE a comment\n\nintro\n00:05.000 --> 00:07.500 align:start\nShort form\n\n01:00:00.000 --> 01:00:01.000\nHour mark\n';
    expect(parseSubtitles(vtt)).toEqual([
      { startSec: 5, endSec: 7.5, text: 'Short form' },
      { startSec: 3600, endSec: 3601, text: 'Hour mark' },
    ]);
  });

  it('formats cue times with sub-second precision', () => {
    expect(formatCueTime(1.5)).toBe('0:01.5');
    expect(formatCueTime(64.25)).toBe('1:04.3');
  });
});
