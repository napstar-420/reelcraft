import type { TimingMap } from '@reelcraft/shared';

/** The words of a text, lowercase and without punctuation, as they are matched. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .split(/[^\p{L}\p{N}']+/u)
    .map((word) => word.replace(/^'+|'+$/g, ''))
    .filter(Boolean);
}

export interface SpokenWord {
  token: string;
  startSec: number;
  endSec: number;
}

/** The voice-over's words as matchable tokens. A word that is only punctuation is dropped. */
export function spokenWords(timing: TimingMap | undefined): SpokenWord[] {
  if (!timing) return [];
  return timing.words.flatMap((word) => {
    const tokens = tokenize(word.text);
    // One timed word is one token, whatever it looks like ("don't", "30-day" counts as two).
    return tokens.map((token) => ({ token, startSec: word.startSec, endSec: word.endSec }));
  });
}

/**
 * Where in the voice-over a phrase is said, within the words given (all of them, or one range): the time the first word is
 * spoken. Matches the whole phrase first, then its first two words, then its longest word, so a
 * cue that is a little off the script still lands near the right place.
 */
export function findCue(
  phrase: string,
  words: readonly SpokenWord[],
  range?: { fromWord: number; toWord: number },
): number | undefined {
  const wanted = tokenize(phrase);
  if (!wanted.length) return undefined;
  const slice = range ? words.slice(range.fromWord, range.toWord) : words;
  const at = (needle: string[]) => {
    for (let i = 0; i + needle.length <= slice.length; i += 1) {
      if (needle.every((token, offset) => slice[i + offset]!.token === token)) return i;
    }
    return -1;
  };
  let index = at(wanted);
  if (index < 0 && wanted.length > 2) index = at(wanted.slice(0, 2));
  if (index < 0) {
    const longest = [...wanted].sort((a, b) => b.length - a.length)[0]!;
    if (longest.length >= 4) index = at([longest]);
  }
  return index < 0 ? undefined : slice[index]!.startSec;
}
