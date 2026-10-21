import { describe, expect, it } from 'vitest';
import { fitText, splitRuns } from './text-fit';

describe('splitRuns', () => {
  const runs = [{ text: 'WHAT ' }, { text: 'REALLY', color: 'accent2' }, { text: ' HAPPENS' }];

  it('keeps each part, with the spaces where they were', () => {
    expect(splitRuns('WHAT REALLY HAPPENS', runs)).toEqual(runs);
  });

  it('puts a line break where the space was, in the part that had it', () => {
    expect(splitRuns('WHAT\nREALLY\nHAPPENS', runs)).toEqual([
      { text: 'WHAT\n' },
      { text: 'REALLY', color: 'accent2' },
      { text: '\nHAPPENS' },
    ]);
  });

  it('splits a part that wraps inside itself, and drops a part that is only spaces', () => {
    const parts = [{ text: 'no web search', color: 'red' }, { text: ' ' }, { text: 'calls' }];
    expect(splitRuns('no web\nsearch calls', parts)).toEqual([
      { text: 'no web\nsearch ', color: 'red' },
      { text: 'calls' },
    ]);
  });

  it('matches what fitText lays out', () => {
    const words = runs.map((run) => run.text).join('');
    const fit = fitText(words, { w: 300, h: 400 }, 60);
    expect(
      splitRuns(fit.text, runs)
        .map((run) => run.text)
        .join(''),
    ).toBe(fit.text);
  });
});
