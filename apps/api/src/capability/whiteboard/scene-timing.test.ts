import { describe, expect, it } from 'vitest';
import { fakeTimingFor } from '../../provider/fake/fake-timing';
import { alignScenes, findCue, spokenWords, tokenize } from './scene-timing';

const narrations = [
  'Most habits happen without us thinking.',
  'First comes the cue. It tells your brain to start.',
  'Then the routine. And finally the reward.',
];
const timing = fakeTimingFor(narrations.join(' '));
const words = spokenWords(timing);

describe('tokenize', () => {
  it('lowercases and drops punctuation and delivery tags', () => {
    expect(tokenize('[whispers] First, comes the CUE!')).toEqual(['first', 'comes', 'the', 'cue']);
    expect(tokenize("Don't stop — 30-day plan")).toEqual(["don't", 'stop', '30', 'day', 'plan']);
    expect(tokenize('')).toEqual([]);
  });
});

describe('alignScenes', () => {
  it('starts each scene at its first spoken word', () => {
    const ranges = alignScenes(narrations, words, timing.durationSec);
    // 6 words, then 10, then 7: at 0.4 seconds a word.
    expect(ranges.map((r) => r.startSec)).toEqual([0, 2.4, 6.4]);
    expect(ranges.map((r) => r.endSec)).toEqual([2.4, 6.4, timing.durationSec]);
    expect(ranges.map((r) => [r.fromWord, r.toWord])).toEqual([
      [0, 6],
      [6, 16],
      [16, 23],
    ]);
  });

  it('always begins the first scene at zero, even if the voice starts late', () => {
    const late = spokenWords({
      ...timing,
      words: timing.words.map((w) => ({ ...w, startSec: w.startSec + 1, endSec: w.endSec + 1 })),
    });
    expect(alignScenes(narrations, late, undefined)[0]!.startSec).toBe(0);
  });

  it('survives a script that differs a little from the voice-over', () => {
    const edited = [...narrations];
    edited[1] = 'First comes the cue. It tells your brain to begin right now.';
    const ranges = alignScenes(edited, words, timing.durationSec);
    expect(ranges[2]!.startSec).toBe(6.4);
  });

  it('times scenes by how long they take to read when there is no voice-over', () => {
    const ranges = alignScenes(narrations, [], undefined);
    expect(ranges[0]).toMatchObject({ startSec: 0, endSec: 2.4 });
    expect(ranges[1]!.startSec).toBe(2.4);
    // Never shorter than two seconds.
    expect(alignScenes(['Hi'], [], undefined)[0]!.endSec).toBe(2);
  });

  it('keeps scenes in order and not empty', () => {
    const ranges = alignScenes(narrations, words, undefined);
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i]!.startSec).toBeGreaterThanOrEqual(ranges[i - 1]!.startSec);
      expect(ranges[i]!.endSec).toBeGreaterThan(ranges[i]!.startSec);
    }
  });
});

describe('findCue', () => {
  const ranges = alignScenes(narrations, words, timing.durationSec);
  it('finds a phrase inside its scene', () => {
    expect(findCue('first comes the cue', words, ranges[1]!)).toBe(2.4);
    expect(findCue('the cue', words, ranges[1]!)).toBeCloseTo(3.2);
    expect(findCue('And finally the reward', words, ranges[2]!)).toBeCloseTo(7.6);
  });

  it('only looks inside the scene it is given', () => {
    expect(findCue('first comes the cue', words, ranges[0]!)).toBeUndefined();
  });

  it('is forgiving about a phrase that is a little off', () => {
    expect(findCue('the cue starts everything', words, ranges[1]!)).toBeCloseTo(3.2);
    expect(findCue('your brain begins', words, ranges[1]!)).toBeCloseTo(4.8);
  });

  it('gives up on a phrase that is not there, or empty', () => {
    expect(findCue('purple elephant', words, ranges[1]!)).toBeUndefined();
    expect(findCue('   ', words, ranges[1]!)).toBeUndefined();
  });
});
