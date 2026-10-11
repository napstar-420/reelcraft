import type { TimingMap } from '@reelcraft/shared';

const SENTENCE_END = /[.!?…。！？]["”’')\]]*$/;

/** A timing map's sentences, from its words: one sentence ends at each word that ends with
 * sentence punctuation, and the words left over make a last one. */
export function sentencesFromWords(words: TimingMap['words']): TimingMap['sentences'] {
  const sentences: TimingMap['sentences'] = [];
  let run: TimingMap['words'] = [];
  const close = () => {
    if (!run.length) return;
    sentences.push({
      text: run.map((word) => word.text).join(' '),
      startSec: run[0]!.startSec,
      endSec: run.at(-1)!.endSec,
    });
    run = [];
  };
  for (const word of words) {
    run.push(word);
    if (SENTENCE_END.test(word.text)) close();
  }
  close();
  return sentences;
}
