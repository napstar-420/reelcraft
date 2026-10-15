/**
 * A strict reader for the SVG path data a model writes. A path is only accepted if every character
 * of it is understood, so nothing but drawing commands and numbers can get through: no markup, no
 * scripts, no references. What it accepts is rewritten in one plain form (absolute commands,
 * rounded numbers), which is what is stored and drawn.
 */

export type PathIssueCode =
  | 'empty'
  | 'too_long'
  | 'bad_syntax'
  | 'no_move'
  | 'unsupported'
  | 'too_many_segments'
  | 'out_of_bounds'
  | 'too_small';

export interface PathIssue {
  code: PathIssueCode;
  message: string;
}

export interface PathLimits {
  /** The grid the drawing is on: coordinates should fall inside it. */
  width: number;
  height: number;
  /** How far outside the grid a point may be, as a share of its size. */
  margin: number;
  maxChars: number;
  maxSegments: number;
  /** A drawing smaller than this, in both directions, can't be seen. */
  minExtent: number;
}

export const DEFAULT_PATH_LIMITS: PathLimits = {
  width: 100,
  height: 100,
  margin: 0.1,
  maxChars: 1500,
  maxSegments: 120,
  minExtent: 2,
};

export interface ParsedPath {
  ok: true;
  /** The path in one plain form: absolute commands, numbers to two places. */
  d: string;
  segments: number;
  bbox: { x1: number; y1: number; x2: number; y2: number };
  /** The straight-line length of the points it passes through; enough to tell a speck from a line. */
  span: number;
}

const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;

const fmt = (value: number) => {
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
};

type Token = { kind: 'command'; value: string } | { kind: 'number'; value: number };

/** Splits path data into commands and numbers, or says what it did not understand. */
function tokenize(d: string): Token[] | PathIssue {
  const tokens: Token[] = [];
  let i = 0;
  // The flags of an arc are single digits that may run into what follows ("a1 1 0 011 1").
  let arcFlag = 0;
  while (i < d.length) {
    const ch = d[i]!;
    if (ch === ' ' || ch === ',' || ch === '\n' || ch === '\t' || ch === '\r') {
      i += 1;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      if (!(ch.toUpperCase() in ARGS)) {
        return {
          code: 'unsupported',
          message: `"${ch}" is not a path command (use M L H V C S Q T A Z)`,
        };
      }
      tokens.push({ kind: 'command', value: ch });
      arcFlag = ch === 'A' || ch === 'a' ? 3 : 0;
      i += 1;
      continue;
    }
    // Inside an arc, the 4th and 5th numbers are flags: one character, 0 or 1.
    const countSinceCommand = tokens.length - 1 - lastCommandIndex(tokens);
    const inArc = arcFlag > 0 && isArc(tokens);
    if (inArc) {
      const position = countSinceCommand % 7;
      if (position === 3 || position === 4) {
        if (ch !== '0' && ch !== '1')
          return { code: 'bad_syntax', message: 'an arc flag must be 0 or 1' };
        tokens.push({ kind: 'number', value: Number(ch) });
        i += 1;
        continue;
      }
    }
    const match = NUMBER.exec(d.slice(i));
    if (!match) {
      return { code: 'bad_syntax', message: `unexpected "${d.slice(i, i + 8)}" in the path` };
    }
    const value = Number(match[0]);
    if (!Number.isFinite(value))
      return { code: 'bad_syntax', message: 'a number in the path is not finite' };
    tokens.push({ kind: 'number', value });
    i += match[0].length;
  }
  return tokens;
}

const lastCommandIndex = (tokens: Token[]) => {
  for (let i = tokens.length - 1; i >= 0; i -= 1) if (tokens[i]!.kind === 'command') return i;
  return -1;
};
const isArc = (tokens: Token[]) => {
  const at = lastCommandIndex(tokens);
  const token = at >= 0 ? tokens[at] : undefined;
  return token?.kind === 'command' && token.value.toUpperCase() === 'A';
};

/** Reads one path and rewrites it in the plain form, or says what is wrong with it. */
export function parseStrictPath(
  input: string,
  limits: PathLimits = DEFAULT_PATH_LIMITS,
): ParsedPath | PathIssue {
  const d = input.trim();
  if (!d) return { code: 'empty', message: 'the path is empty' };
  if (d.length > limits.maxChars) {
    return {
      code: 'too_long',
      message: `the path is ${d.length} characters; the most is ${limits.maxChars}`,
    };
  }
  const tokens = tokenize(d);
  if (!Array.isArray(tokens)) return tokens;
  if (tokens[0]?.kind !== 'command' || tokens[0].value.toUpperCase() !== 'M') {
    return { code: 'no_move', message: 'a path must start with M (move to)' };
  }

  const out: string[] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let segments = 0;
  let bx1 = Infinity;
  let by1 = Infinity;
  let bx2 = -Infinity;
  let by2 = -Infinity;
  let span = 0;
  let px = NaN;
  let py = NaN;
  const reach = (nx: number, ny: number) => {
    bx1 = Math.min(bx1, nx);
    by1 = Math.min(by1, ny);
    bx2 = Math.max(bx2, nx);
    by2 = Math.max(by2, ny);
    if (!Number.isNaN(px)) span += Math.hypot(nx - px, ny - py);
    px = nx;
    py = ny;
  };

  let i = 0;
  let command = '';
  while (i < tokens.length) {
    const token = tokens[i]!;
    if (token.kind === 'command') {
      command = token.value;
      i += 1;
      if (command.toUpperCase() === 'Z') {
        segments += 1;
        out.push('Z');
        x = startX;
        y = startY;
        reach(x, y);
        continue;
      }
    } else if (!command || command.toUpperCase() === 'Z') {
      return { code: 'bad_syntax', message: 'a number with no command in front of it' };
    }
    const upper = command.toUpperCase();
    const need = ARGS[upper]!;
    const relative = command !== upper;
    const args: number[] = [];
    for (let k = 0; k < need; k += 1) {
      const t = tokens[i + k];
      if (!t || t.kind !== 'number') {
        return { code: 'bad_syntax', message: `${command} needs ${need} numbers` };
      }
      args.push(t.value);
    }
    i += need;
    segments += 1;
    if (segments > limits.maxSegments) {
      return {
        code: 'too_many_segments',
        message: `more than ${limits.maxSegments} segments in one path`,
      };
    }
    const ax = (value: number) => (relative ? x + value : value);
    const ay = (value: number) => (relative ? y + value : value);
    switch (upper) {
      case 'M': {
        const nx = ax(args[0]!);
        const ny = ay(args[1]!);
        out.push(`M ${fmt(nx)} ${fmt(ny)}`);
        x = startX = nx;
        y = startY = ny;
        reach(x, y);
        // More pairs after a move are lines.
        command = relative ? 'l' : 'L';
        break;
      }
      case 'L':
      case 'T': {
        const nx = ax(args[0]!);
        const ny = ay(args[1]!);
        out.push(`${upper} ${fmt(nx)} ${fmt(ny)}`);
        x = nx;
        y = ny;
        reach(x, y);
        break;
      }
      case 'H': {
        const nx = ax(args[0]!);
        out.push(`L ${fmt(nx)} ${fmt(y)}`);
        x = nx;
        reach(x, y);
        break;
      }
      case 'V': {
        const ny = ay(args[0]!);
        out.push(`L ${fmt(x)} ${fmt(ny)}`);
        y = ny;
        reach(x, y);
        break;
      }
      case 'C': {
        const pts = [
          ax(args[0]!),
          ay(args[1]!),
          ax(args[2]!),
          ay(args[3]!),
          ax(args[4]!),
          ay(args[5]!),
        ];
        out.push(`C ${pts.map(fmt).join(' ')}`);
        reach(pts[0]!, pts[1]!);
        reach(pts[2]!, pts[3]!);
        x = pts[4]!;
        y = pts[5]!;
        reach(x, y);
        break;
      }
      case 'S':
      case 'Q': {
        const pts = [ax(args[0]!), ay(args[1]!), ax(args[2]!), ay(args[3]!)];
        out.push(`${upper} ${pts.map(fmt).join(' ')}`);
        reach(pts[0]!, pts[1]!);
        x = pts[2]!;
        y = pts[3]!;
        reach(x, y);
        break;
      }
      case 'A': {
        const nx = ax(args[5]!);
        const ny = ay(args[6]!);
        const rx = Math.abs(args[0]!);
        const ry = Math.abs(args[1]!);
        if (rx > limits.width * 4 || ry > limits.height * 4) {
          return { code: 'out_of_bounds', message: 'an arc is far bigger than the drawing' };
        }
        out.push(
          `A ${fmt(rx)} ${fmt(ry)} ${fmt(args[2]!)} ${args[3]! ? 1 : 0} ${args[4]! ? 1 : 0} ${fmt(nx)} ${fmt(ny)}`,
        );
        x = nx;
        y = ny;
        reach(x, y);
        break;
      }
    }
  }

  const marginX = limits.width * limits.margin;
  const marginY = limits.height * limits.margin;
  if (
    bx1 < -marginX ||
    by1 < -marginY ||
    bx2 > limits.width + marginX ||
    by2 > limits.height + marginY
  ) {
    return {
      code: 'out_of_bounds',
      message: `the path leaves the ${limits.width} by ${limits.height} grid (it spans ${fmt(bx1)},${fmt(by1)} to ${fmt(bx2)},${fmt(by2)})`,
    };
  }
  if (bx2 - bx1 < limits.minExtent && by2 - by1 < limits.minExtent) {
    return { code: 'too_small', message: 'the path is too small to see' };
  }
  return {
    ok: true,
    d: out.join(' '),
    segments,
    bbox: { x1: bx1, y1: by1, x2: bx2, y2: by2 },
    span,
  };
}

export const isParsed = (result: ParsedPath | PathIssue): result is ParsedPath =>
  'ok' in result && result.ok;
