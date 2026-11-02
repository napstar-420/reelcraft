import { describe, expect, it } from 'vitest';
import {
  keyframeTime,
  parseEbur128,
  parseSceneScores,
  perSecond,
  shotsFrom,
  soundBetweenWords,
  wordsPerMinute,
} from './media-analysis.logic';

describe('shots', () => {
  const log = [
    'frame:0    pts:0      pts_time:0',
    'lavfi.scene_score=0.000000',
    'frame:38   pts:19456  pts_time:1.52',
    'lavfi.scene_score=0.400000',
    'frame:40   pts:20480  pts_time:1.6',
    'lavfi.scene_score=0.900000',
    'frame:88   pts:45056  pts_time:3.52',
    'lavfi.scene_score=0.350000',
    'frame:90   pts:46080  pts_time:3.6',
    'lavfi.scene_score=0.100000',
  ].join('\n');

  it('reads a score per frame', () => {
    expect(parseSceneScores(log)).toHaveLength(5);
    expect(parseSceneScores(log)[1]).toEqual({ t: 1.52, score: 0.4 });
  });

  it('cuts at big changes, keeping the stronger of two cuts too close together', () => {
    const { shots } = shotsFrom(parseSceneScores(log), 4.5);
    expect(shots).toEqual([
      { index: 0, startSec: 0, endSec: 1.6 },
      { index: 1, startSec: 1.6, endSec: 3.52 },
      { index: 2, startSec: 3.52, endSec: 4.5 },
    ]);
    expect(keyframeTime(shots[1]!)).toBe(2.56);
  });

  it('raises the threshold when there would be too many shots', () => {
    const scores = Array.from({ length: 50 }, (_, i) => ({
      t: i + 0.5,
      score: i % 5 === 0 ? 0.9 : 0.35,
    }));
    const { shots, threshold } = shotsFrom(scores, 51, { maxShots: 11 });
    expect(shots.length).toBe(11);
    expect(threshold).toBe(0.9);
    expect(shots.slice(1).map((s) => s.startSec)).toEqual([
      0.5, 5.5, 10.5, 15.5, 20.5, 25.5, 30.5, 35.5, 40.5, 45.5,
    ]);
  });

  it('is one shot when nothing changes', () => {
    expect(shotsFrom([], 10).shots).toEqual([{ index: 0, startSec: 0, endSec: 10 }]);
  });
});

describe('sound', () => {
  it('reads momentary loudness and keeps the loudest moment of each second', () => {
    const points = parseEbur128(
      [
        '[Parsed_ebur128_0 @ 0x1] t: 0.0999   TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS',
        '[Parsed_ebur128_0 @ 0x1] t: 0.4999   TARGET:-23 LUFS    M: -21.8 S:-120.7     I: -21.8 LUFS',
        '[Parsed_ebur128_0 @ 0x1] t: 1.2      TARGET:-23 LUFS    M: -30.2 S: -25.0     I: -22.0 LUFS',
        'unrelated line',
      ].join('\n'),
    );
    expect(points).toEqual([
      { t: 0.0999, lufs: -120.7 },
      { t: 0.4999, lufs: -21.8 },
      { t: 1.2, lufs: -30.2 },
    ]);
    expect(perSecond(points, 3)).toEqual([-22, -30, -70]);
  });

  it('notices sound between the words, and the speaking pace', () => {
    const words = [
      { startSec: 0, endSec: 0.5 },
      { startSec: 0.5, endSec: 1 },
      { startSec: 1, endSec: 1.4 },
      { startSec: 1.4, endSec: 1.8 },
      { startSec: 1.8, endSec: 2.5 },
    ];
    expect(soundBetweenWords([-20, -20, -20, -25, -24, -26], words)).toEqual({
      seconds: 3,
      of: 3,
      likelyMusic: true,
    });
    expect(soundBetweenWords([-20, -20, -20, -70, -70, -70], words).likelyMusic).toBe(false);
    expect(wordsPerMinute(words)).toBe(120);
    expect(wordsPerMinute(words.slice(0, 2))).toBeNull();
  });
});
