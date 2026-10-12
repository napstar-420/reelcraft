import type { CaptionPage, CaptionWord } from '@reelcraft/timeline-composition/src/captions';

const round = (value: number) => Math.round(value * 1000) / 1000;

const pageOf = (words: CaptionWord[]): CaptionPage => ({
  words,
  startSec: words[0]!.startSec,
  endSec: words.at(-1)!.endSec,
});

/** What the schema stores for a page. */
export type StoredPage = { words: CaptionWord[] };

export const toStoredPages = (pages: CaptionPage[]): StoredPage[] =>
  pages.map((page) => ({ words: page.words.map((word) => ({ ...word })) }));

export const pageText = (page: CaptionPage): string =>
  page.words.map((word) => word.text).join(' ');

/** Replaces the words of one page with what was typed. When the number of words is the same,
 * each keeps its own timing (a spelling fix). Otherwise the page's time is shared among the new
 * words by their length, so the captions still fill the same stretch of the voice-over. Empty
 * text changes nothing. */
export function setPageText(
  pages: CaptionPage[],
  index: number,
  text: string,
): CaptionPage[] | undefined {
  const page = pages[index];
  const tokens = text.split(/\s+/).filter(Boolean);
  if (!page || tokens.length === 0) return undefined;
  if (tokens.join(' ') === pageText(page)) return undefined;

  let words: CaptionWord[];
  if (tokens.length === page.words.length) {
    words = page.words.map((word, i) => ({ ...word, text: tokens[i]! }));
  } else {
    const weights = tokens.map((token) => Math.max(1, token.length));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const span = Math.max(page.endSec - page.startSec, 0.05 * tokens.length);
    let cursor = page.startSec;
    words = tokens.map((token, i) => {
      const start = cursor;
      cursor += (weights[i]! / total) * span;
      return { text: token, startSec: round(start), endSec: round(cursor) };
    });
  }
  return pages.map((existing, i) => (i === index ? pageOf(words) : existing));
}

/** Splits a page into two, after `afterWord` words (the middle by default). */
export function splitPage(
  pages: CaptionPage[],
  index: number,
  afterWord?: number,
): CaptionPage[] | undefined {
  const page = pages[index];
  if (!page || page.words.length < 2) return undefined;
  const at = Math.min(
    page.words.length - 1,
    Math.max(1, afterWord ?? Math.ceil(page.words.length / 2)),
  );
  return [
    ...pages.slice(0, index),
    pageOf(page.words.slice(0, at)),
    pageOf(page.words.slice(at)),
    ...pages.slice(index + 1),
  ];
}

/** Joins a page with the one after it. */
export function mergeWithNext(pages: CaptionPage[], index: number): CaptionPage[] | undefined {
  const page = pages[index];
  const next = pages[index + 1];
  if (!page || !next) return undefined;
  return [
    ...pages.slice(0, index),
    pageOf([...page.words, ...next.words]),
    ...pages.slice(index + 2),
  ];
}

/** Removes a page (its words are no longer shown). The last page can't be removed: an item with
 * no pages falls back to the transcript. */
export function removePage(pages: CaptionPage[], index: number): CaptionPage[] | undefined {
  if (pages.length < 2 || !pages[index]) return undefined;
  return pages.filter((_, i) => i !== index);
}
