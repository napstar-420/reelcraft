const sentences = new Intl.Segmenter(undefined, { granularity: 'sentence' });

/**
 * Splits `text` into pieces of at most `maxChars`, breaking at sentence ends
 * where it can and at words (then characters) where a sentence is longer than
 * a piece. Joining the pieces with a space gives back the text.
 */
export function splitSpeechText(text: string, maxChars: number): string[] {
  const whole = text.trim();
  if (whole.length <= maxChars) return [whole];
  const pieces: string[] = [];
  let current = '';
  const flush = () => {
    if (current) pieces.push(current);
    current = '';
  };
  for (const { segment } of sentences.segment(whole)) {
    for (const part of fit(segment.trim(), maxChars)) {
      if (current && current.length + 1 + part.length > maxChars) flush();
      current = current ? `${current} ${part}` : part;
    }
  }
  flush();
  return pieces;
}

/** `sentence` as one part, or as several when it is longer than `maxChars`. */
function fit(sentence: string, maxChars: number): string[] {
  if (sentence.length <= maxChars) return sentence ? [sentence] : [];
  const parts: string[] = [];
  let current = '';
  for (const word of sentence.split(/\s+/)) {
    if (word.length > maxChars) {
      if (current) parts.push(current);
      current = '';
      for (let i = 0; i < word.length; i += maxChars) parts.push(word.slice(i, i + maxChars));
      continue;
    }
    if (current && current.length + 1 + word.length > maxChars) {
      parts.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) parts.push(current);
  return parts;
}
