import { describe, expect, it } from 'vitest';
import { activeCaption, captionPages } from '@reelcraft/timeline-composition/src/captions';

/** Words spoken back to back, each `len` seconds long, from `start`. */
function speak(texts: string[], start = 0, len = 0.3) {
  return texts.map((text, i) => ({
    text,
    startSec: start + i * len,
    endSec: start + (i + 1) * len,
  }));
}

const texts = (pages: ReturnType<typeof captionPages>) =>
  pages.map((page) => page.words.map((word) => word.text).join(' '));

describe('captionPages', () => {
  it('shows a few words at a time instead of a whole sentence', () => {
    const pages = captionPages(speak(['Milo', 'had', 'one', 'dream', 'cook', 'where', 'kings']));
    expect(texts(pages)).toEqual(['Milo had one', 'dream cook where', 'kings']);
  });

  it('ends a page at the end of a sentence', () => {
    const pages = captionPages(speak(['He', 'ate.', 'Then', 'he', 'slept', 'well']));
    expect(texts(pages)).toEqual(['He ate.', 'Then he slept', 'well']);
  });

  it('breaks at a comma once the page has two words, not after one', () => {
    expect(texts(captionPages(speak(['Well,', 'milo', 'cooked,', 'then', 'ate'])))).toEqual([
      'Well, milo cooked,',
      'then ate',
    ]);
    expect(texts(captionPages(speak(['So', 'tired,', 'he', 'slept'])))).toEqual([
      'So tired,',
      'he slept',
    ]);
  });

  it('starts a new page after a pause', () => {
    const words = [...speak(['one', 'two']), ...speak(['three', 'four'], 2)];
    expect(texts(captionPages(words))).toEqual(['one two', 'three four']);
  });

  it('honours a words-per-page setting and tolerates an empty list', () => {
    expect(texts(captionPages(speak(['a', 'b', 'c', 'd']), { wordsPerPage: 2 }))).toEqual([
      'a b',
      'c d',
    ]);
    expect(captionPages([])).toEqual([]);
  });
});

describe('activeCaption', () => {
  const pages = captionPages([...speak(['one', 'two', 'three']), ...speak(['four'], 5)]);

  it('picks the page on screen and the word being spoken', () => {
    expect(activeCaption(pages, 0.4)?.wordIndex).toBe(1);
    expect(activeCaption(pages, 0.4)?.page.words).toHaveLength(3);
  });

  it('keeps a page up briefly after its last word, then clears it in a long pause', () => {
    expect(activeCaption(pages, 1.1)).toBeDefined();
    expect(activeCaption(pages, 3)).toBeUndefined();
  });

  it('shows nothing before the first word', () => {
    const late = captionPages(speak(['hi'], 2));
    expect(activeCaption(late, 1)).toBeUndefined();
    expect(activeCaption(late, 2.1)?.wordIndex).toBe(0);
  });
});
