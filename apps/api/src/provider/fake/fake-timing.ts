import type { TimingMap } from '@reelcraft/shared';

/** How long the fake voice takes per word: 2.5 words a second, steady. */
export const FAKE_SECONDS_PER_WORD = 0.4;

/**
 * Word and sentence timings for the fake voice: every word the same length,
 * back to back, with a sentence ending at `.`, `!` or `?`. Real enough for
 * tests that place things at spoken words, and free and deterministic.
 */
export function fakeTimingFor(text: string): TimingMap {
  const words = text
    .replace(/\[[^\]]*\]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((raw, index) => ({
      text: raw,
      startSec: round(index * FAKE_SECONDS_PER_WORD),
      endSec: round((index + 1) * FAKE_SECONDS_PER_WORD),
    }));
  const sentences: TimingMap['sentences'] = [];
  let first = 0;
  words.forEach((word, index) => {
    const last = index === words.length - 1;
    if (!last && !/[.!?]["')\]]*$/.test(word.text)) return;
    const part = words.slice(first, index + 1);
    sentences.push({
      text: part.map((w) => w.text).join(' '),
      startSec: part[0]!.startSec,
      endSec: part[part.length - 1]!.endSec,
    });
    first = index + 1;
  });
  return {
    transcript: words.map((w) => w.text).join(' '),
    durationSec: round(words.length * FAKE_SECONDS_PER_WORD),
    sentences,
    words,
  };
}

const round = (value: number) => Math.round(value * 1000) / 1000;
