export interface FittedText {
  size: number;
  /** The words, broken into lines with `\n`, so it wraps the same everywhere. */
  text: string;
  lines: number;
  /** How wide the widest line is, and how tall all of them are. */
  width: number;
  height: number;
  /** Whether it still didn't fit at the smallest size. */
  overflow: boolean;
}

const CHAR_WIDTH = 0.45;
const LINE_HEIGHT = 1.12;

/** The biggest size, down from `maxSize`, at which the words fit the box, wrapped at spaces. */
export function fitText(
  text: string,
  area: { w: number; h: number },
  maxSize: number,
  minSize = 18,
): FittedText {
  const words = text.trim().split(/\s+/);
  let size = maxSize;
  let result: FittedText | undefined;
  while (size >= minSize - 0.001) {
    const maxChars = Math.max(1, Math.floor(area.w / (size * CHAR_WIDTH)));
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      if (current && `${current} ${word}`.length > maxChars) {
        lines.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    if (current) lines.push(current);
    const width = Math.max(...lines.map((line) => line.length)) * size * CHAR_WIDTH;
    const height = lines.length * size * LINE_HEIGHT;
    result = {
      size: Math.round(size),
      text: lines.join('\n'),
      lines: lines.length,
      width,
      height,
      overflow: false,
    };
    if (height <= area.h && width <= area.w) return result;
    size *= 0.93;
  }
  return { ...result!, overflow: true };
}

/**
 * Puts the line breaks and spaces of `wrapped` (the runs' words as `fitText` laid them out) back
 * into the runs, so each part keeps its own look. A space between two parts goes with the part
 * that had it; a part left with nothing is dropped.
 */
export function splitRuns<T extends { text: string }>(wrapped: string, runs: readonly T[]): T[] {
  const isSpace = (char: string) => /\s/.test(char);
  // The run each letter of the words belongs to, in order.
  const owner = runs.flatMap((run, index) =>
    [...run.text].filter((char) => !isSpace(char)).map(() => index),
  );
  const texts = runs.map(() => '');
  let letter = 0;
  for (const char of wrapped) {
    if (!isSpace(char)) {
      texts[owner[letter] ?? runs.length - 1] += char;
      letter += 1;
      continue;
    }
    const before = owner[letter - 1] ?? 0;
    const after = owner[letter] ?? before;
    const nextStartsWithSpace = after !== before && isSpace(runs[after]!.text[0] ?? '');
    const prevEndsWithSpace = isSpace(runs[before]!.text.at(-1) ?? '');
    texts[nextStartsWithSpace && !prevEndsWithSpace ? after : before] += char;
  }
  return runs.flatMap((run, index) => (texts[index] ? [{ ...run, text: texts[index]! }] : []));
}
