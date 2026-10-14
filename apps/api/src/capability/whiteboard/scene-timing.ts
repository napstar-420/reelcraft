import type { TimingMap } from '@reelcraft/shared';

/** How fast narration is read when there is no voice-over to time it by. */
export const WORDS_PER_SECOND = 2.5;
const MIN_SCENE_SEC = 2;

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

export interface SceneRange {
  /** Index into the spoken words where the scene begins, and where it ends (exclusive). */
  fromWord: number;
  toWord: number;
  startSec: number;
  endSec: number;
}

/**
 * When each scene is on screen. With a voice-over, a scene begins at its first word: found by
 * matching the start of its narration against the spoken words, in order, so a small difference
 * between the script and the voice-over doesn't shift every scene after it. Without one, scenes
 * last as long as their words take to read.
 */
export function alignScenes(
  narrations: readonly string[],
  words: readonly SpokenWord[],
  totalSec: number | undefined,
): SceneRange[] {
  const tokens = narrations.map(tokenize);
  if (!words.length) {
    let cursor = 0;
    return tokens.map((scene) => {
      const duration = Math.max(MIN_SCENE_SEC, scene.length / WORDS_PER_SECOND);
      const range = { fromWord: 0, toWord: 0, startSec: cursor, endSec: cursor + duration };
      cursor += duration;
      return range;
    });
  }
  const starts: number[] = [];
  let pointer = 0;
  tokens.forEach((scene, index) => {
    let found = -1;
    if (index === 0) {
      found = 0;
    } else {
      const probe = scene.slice(0, Math.min(3, scene.length));
      // Look a little behind where the script says we are, too: a script that runs longer than
      // the voice-over would otherwise carry every scene after it past its real start.
      const earliest = (starts[index - 1] ?? 0) + 1;
      const limit = Math.min(words.length - 1, pointer + scene.length + 12);
      for (let at = earliest; at <= limit && probe.length; at += 1) {
        if (!probe.every((token, offset) => words[at + offset]?.token === token)) continue;
        // Of the places it could be, the one nearest where the script says we are.
        if (found < 0 || Math.abs(at - pointer) < Math.abs(found - pointer)) found = at;
      }
    }
    const from = Math.min(found >= 0 ? found : pointer, words.length - 1);
    starts.push(from);
    pointer = Math.min(from + scene.length, words.length - 1);
  });
  const end = totalSec ?? words[words.length - 1]!.endSec;
  return starts.map((from, index) => {
    const to = index + 1 < starts.length ? starts[index + 1]! : words.length;
    const startSec = index === 0 ? 0 : words[from]!.startSec;
    const endSec = index + 1 < starts.length ? words[starts[index + 1]!]!.startSec : end;
    return {
      fromWord: from,
      toWord: Math.max(to, from),
      startSec,
      endSec: Math.max(endSec, startSec + 0.5),
    };
  });
}

/**
 * Where in the voice-over a phrase is said, within one scene's words: the time the first word is
 * spoken. Matches the whole phrase first, then its first two words, then its longest word, so a
 * cue that is a little off the script still lands near the right place.
 */
export function findCue(
  phrase: string,
  words: readonly SpokenWord[],
  range: Pick<SceneRange, 'fromWord' | 'toWord'>,
): number | undefined {
  const wanted = tokenize(phrase);
  if (!wanted.length) return undefined;
  const slice = words.slice(range.fromWord, range.toWord);
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
