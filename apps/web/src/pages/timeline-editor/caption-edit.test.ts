import { describe, expect, it } from 'vitest';
import { captionPages } from '@reelcraft/timeline-composition/src/captions';
import {
  mergeWithNext,
  pageText,
  removePage,
  setPageText,
  splitPage,
  toStoredPages,
} from './caption-edit';

const words = [
  { text: 'Milo', startSec: 0, endSec: 0.4 },
  { text: 'had', startSec: 0.4, endSec: 0.6 },
  { text: 'one', startSec: 0.6, endSec: 0.9 },
  { text: 'dream.', startSec: 0.9, endSec: 1.6 },
  { text: 'He', startSec: 1.7, endSec: 1.9 },
  { text: 'cooked.', startSec: 1.9, endSec: 2.5 },
];
const pages = () => captionPages(words);
const texts = (p: ReturnType<typeof pages>) => p.map(pageText);

describe('setPageText', () => {
  it('fixes a word and keeps every timing when the count is the same', () => {
    const next = setPageText(pages(), 0, 'Milo had won')!;
    expect(pageText(next[0]!)).toBe('Milo had won');
    expect(next[0]!.words.map((w) => w.startSec)).toEqual([0, 0.4, 0.6]);
    expect(next[1]).toEqual(pages()[1]);
  });

  it('shares the page’s time among a different number of words, over the same stretch', () => {
    const next = setPageText(pages(), 0, 'Milo had a big dream')!;
    const page = next[0]!;
    expect(page.words).toHaveLength(5);
    expect(page.startSec).toBe(0);
    expect(page.endSec).toBeCloseTo(0.9, 2);
    for (let i = 1; i < page.words.length; i += 1) {
      expect(page.words[i]!.startSec).toBeGreaterThanOrEqual(page.words[i - 1]!.endSec - 0.002);
    }
  });

  it('changes nothing for empty or identical text', () => {
    expect(setPageText(pages(), 0, '   ')).toBeUndefined();
    expect(setPageText(pages(), 0, 'Milo had one')).toBeUndefined();
    expect(setPageText(pages(), 9, 'x')).toBeUndefined();
  });
});

describe('splitPage, mergeWithNext, removePage', () => {
  it('splits a page in the middle, or after a chosen word', () => {
    expect(texts(splitPage(pages(), 0)!)).toEqual(['Milo had', 'one', 'dream.', 'He cooked.']);
    expect(texts(splitPage(pages(), 0, 1)!)).toEqual(['Milo', 'had one', 'dream.', 'He cooked.']);
    expect(splitPage(splitPage(pages(), 0)!, 1)).toBeUndefined();
  });

  it('merges with the next page', () => {
    expect(texts(mergeWithNext(pages(), 1)!)).toEqual(['Milo had one', 'dream. He cooked.']);
    expect(mergeWithNext(pages(), 2)).toBeUndefined();
  });

  it('removes a page but never the last one', () => {
    expect(texts(removePage(pages(), 0)!)).toEqual(['dream.', 'He cooked.']);
    expect(removePage([pages()[0]!], 0)).toBeUndefined();
  });
});

describe('toStoredPages', () => {
  it('keeps only the words, ready to save', () => {
    expect(toStoredPages(pages())[0]).toEqual({ words: words.slice(0, 3) });
  });
});
