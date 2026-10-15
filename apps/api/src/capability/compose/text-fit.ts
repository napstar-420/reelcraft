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
