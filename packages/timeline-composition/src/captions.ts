export type CaptionWord = { text: string; startSec: number; endSec: number };

/** A few words shown together, from the first word's start to the last word's end. */
export type CaptionPage = { words: CaptionWord[]; startSec: number; endSec: number };

export const DEFAULT_WORDS_PER_PAGE = 3;
/** A silence this long between two words starts a new page. */
const PAUSE_SEC = 0.6;
/** How long a page stays up after its last word when nothing follows soon. */
const HOLD_SEC = 0.4;

const SENTENCE_END = /[.!?…。！？]["”’')\]]*$/;
const CLAUSE_END = /[,;:，；：]["”’')\]]*$/;

/** Splits spoken words into short pages for captions: a page ends at the end of a sentence, at
 * a comma once it has two words, at a pause, or when it has `wordsPerPage` words. The preview
 * and the final render both call this, so they break the same way. */
export function captionPages(
  words: CaptionWord[],
  options: { wordsPerPage?: number | undefined } = {},
): CaptionPage[] {
  const perPage = Math.max(1, Math.floor(options.wordsPerPage ?? DEFAULT_WORDS_PER_PAGE));
  const pages: CaptionPage[] = [];
  let run: CaptionWord[] = [];
  const close = () => {
    if (!run.length) return;
    pages.push({ words: run, startSec: run[0]!.startSec, endSec: run.at(-1)!.endSec });
    run = [];
  };
  for (const word of words) {
    const last = run.at(-1);
    if (last && word.startSec - last.endSec >= PAUSE_SEC) close();
    run.push(word);
    if (
      run.length >= perPage ||
      SENTENCE_END.test(word.text) ||
      (run.length >= 2 && CLAUSE_END.test(word.text))
    ) {
      close();
    }
  }
  close();
  return pages;
}

/** The page on screen at `second` and the word being spoken in it, if any. A page stays up
 * until the next one starts, or briefly after its last word when a pause follows. */
export function activeCaption(
  pages: CaptionPage[],
  second: number,
): { page: CaptionPage; wordIndex: number } | undefined {
  for (const [index, page] of pages.entries()) {
    const until = Math.min(pages[index + 1]?.startSec ?? Infinity, page.endSec + HOLD_SEC);
    if (second < page.startSec || second >= until) continue;
    let wordIndex = 0;
    for (const [i, word] of page.words.entries()) if (word.startSec <= second) wordIndex = i;
    return { page, wordIndex };
  }
  return undefined;
}

/** Pages stored on a captions item (the person's edits), in the shape the player shows. */
export function pagesFromStored(
  stored: ReadonlyArray<{ words: ReadonlyArray<CaptionWord> }>,
): CaptionPage[] {
  return stored
    .filter((page) => page.words.length > 0)
    .map((page) => ({
      words: page.words.map((word) => ({ ...word })),
      startSec: page.words[0]!.startSec,
      endSec: page.words.at(-1)!.endSec,
    }));
}

/** The pages a captions item shows: the person's edited pages if there are any, otherwise the
 * transcript's words, paged automatically (`wordsPerPage` is the already-resolved setting). */
export function captionPagesFor(
  item: { pages?: ReadonlyArray<{ words: ReadonlyArray<CaptionWord> }> | undefined },
  words: CaptionWord[],
  wordsPerPage: number | undefined,
): CaptionPage[] {
  if (item.pages?.length) return pagesFromStored(item.pages);
  return captionPages(words, { wordsPerPage });
}
