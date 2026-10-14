import { describe, expect, it } from 'vitest';
import { TimingMap } from '@reelcraft/shared';
import { fakeTimingFor } from './fake-timing';

describe('fakeTimingFor', () => {
  it('times every word the same, back to back', () => {
    const timing = fakeTimingFor('Habits run on loops.');
    expect(TimingMap.parse(timing)).toEqual(timing);
    expect(timing.words.map((w) => [w.text, w.startSec, w.endSec])).toEqual([
      ['Habits', 0, 0.4],
      ['run', 0.4, 0.8],
      ['on', 0.8, 1.2],
      ['loops.', 1.2, 1.6],
    ]);
    expect(timing.durationSec).toBe(1.6);
  });

  it('splits sentences at . ! and ?', () => {
    const timing = fakeTimingFor('First cue. Then routine! Reward?');
    expect(timing.sentences).toEqual([
      { text: 'First cue.', startSec: 0, endSec: 0.8 },
      { text: 'Then routine!', startSec: 0.8, endSec: 1.6 },
      { text: 'Reward?', startSec: 1.6, endSec: 2 },
    ]);
  });

  it('puts a trailing fragment in its own sentence and skips delivery tags', () => {
    const timing = fakeTimingFor('[whispers] Wait for it');
    expect(timing.words.map((w) => w.text)).toEqual(['Wait', 'for', 'it']);
    expect(timing.sentences).toHaveLength(1);
  });

  it('handles empty text', () => {
    expect(fakeTimingFor('  ')).toEqual({
      transcript: '',
      durationSec: 0,
      sentences: [],
      words: [],
    });
  });
});
