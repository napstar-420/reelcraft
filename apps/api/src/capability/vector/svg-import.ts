import { isParsed, parseStrictPath, type PathLimits } from './svg-path';

/**
 * Reads an SVG file someone uploaded into the lines Reelcraft draws: paths, rectangles, circles,
 * ellipses, lines and polygons, with their colours and the transforms of the groups they sit in.
 * Anything it doesn't understand is left out, and what is unsafe (scripts, foreign objects, event
 * handlers) refuses the whole file. Text is not drawn: convert it to outlines first.
 */

export const SVG_IMPORT_LIMITS = {
  maxBytes: 512 * 1024,
  maxStrokes: 60,
  maxPathChars: 8000,
  maxSegmentsPerPath: 600,
  /** Large drawings are scaled down to fit this many units. */
  maxSize: 1000,
} as const;

export interface ImportedStroke {
  d: string;
  color?: string;
  fill?: string;
  weight?: 'thin' | 'normal' | 'bold';
}

export type SvgImport =
  | {
      ok: true;
      viewBox: { width: number; height: number };
      strokes: ImportedStroke[];
      /** What was left out because it can't be drawn (text, images, gradients). */
      skipped: string[];
    }
  | { ok: false; message: string };

interface Tag {
  name: string;
  attrs: Record<string, string>;
  closing: boolean;
  selfClosing: boolean;
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

const num = (value: string | undefined, fallback = 0): number => {
  if (value === undefined) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const fmt = (value: number) => {
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
};

/** The tags of an SVG, in order. Comments, the XML header and doctype are dropped. */
function tags(svg: string): Tag[] {
  const stripped = svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^>]*(?:\[[\s\S]*?\])?>/gi, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const result: Tag[] = [];
  const pattern = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(stripped))) {
    const attrs: Record<string, string> = {};
    const attrPattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let attr: RegExpExecArray | null;
    while ((attr = attrPattern.exec(match[3]!))) attrs[attr[1]!] = attr[2] ?? attr[3] ?? '';
    result.push({
      name: match[2]!.replace(/^svg:/, '').toLowerCase(),
      attrs,
      closing: match[1] === '/',
      selfClosing: match[4] === '/',
    });
  }
  return result;
}

function parseTransform(value: string | undefined): Matrix | { error: string } {
  if (!value) return IDENTITY;
  let m = IDENTITY;
  const pattern = /(\w+)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    const args = match[2]!
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (args.some((arg) => !Number.isFinite(arg))) return { error: 'a transform has a bad number' };
    let t: Matrix;
    switch (match[1]) {
      case 'translate':
        t = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
        break;
      case 'scale':
        t = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const a = ((args[0] ?? 0) * Math.PI) / 180;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const cx = args[1] ?? 0;
        const cy = args[2] ?? 0;
        t = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
        break;
      }
      case 'matrix':
        if (args.length !== 6) return { error: 'a matrix transform needs six numbers' };
        t = args as Matrix;
        break;
      default:
        return { error: `the transform "${match[1]}" is not supported` };
    }
    m = multiply(m, t);
  }
  return m;
}

const COMMAND_ARGS: Record<string, number> = { M: 2, L: 2, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** Moves a path (in the plain form `parseStrictPath` writes) through a transform. */
function transformPath(d: string, m: Matrix): string | { error: string } {
  const [a, b, c, dd, e, f] = m;
  const tokens = d.split(' ');
  const out: string[] = [];
  const point = (x: number, y: number) => [a * x + c * y + e, b * x + dd * y + f] as const;
  const scale = Math.hypot(a, b);
  const uniform = Math.abs(scale - Math.hypot(c, dd)) < 1e-6 && Math.abs(a * c + b * dd) < 1e-6;
  const flipped = a * dd - b * c < 0;
  let i = 0;
  while (i < tokens.length) {
    const command = tokens[i]!;
    const need = COMMAND_ARGS[command];
    if (need === undefined) return { error: 'the path has a command Reelcraft does not read' };
    const args = tokens.slice(i + 1, i + 1 + need).map(Number);
    i += 1 + need;
    if (command === 'Z') {
      out.push('Z');
    } else if (command === 'A') {
      if (!uniform) {
        return {
          error:
            'an arc is stretched or skewed by a transform; convert the shape to a path with curves',
        };
      }
      const [x, y] = point(args[5]!, args[6]!);
      const rotation = args[2]! + (Math.atan2(b, a) * 180) / Math.PI;
      out.push(
        `A ${fmt(args[0]! * scale)} ${fmt(args[1]! * scale)} ${fmt(rotation)} ${args[3]} ${flipped ? 1 - args[4]! : args[4]} ${fmt(x)} ${fmt(y)}`,
      );
    } else {
      const moved: number[] = [];
      for (let k = 0; k < args.length; k += 2) {
        const [x, y] = point(args[k]!, args[k + 1]!);
        moved.push(x, y);
      }
      out.push(`${command} ${moved.map(fmt).join(' ')}`);
    }
  }
  return out.join(' ');
}

const SAFE_COLOR = /^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20}|(?:rgb|hsl)a?\([\d\s.,%-]+\))$/;

/** A colour from an attribute: `none` and gradients (`url(#...)`) are not drawn as colours. */
function colorOf(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const v = value.trim();
  if (v === '' || v === 'inherit') return undefined;
  if (v === 'none' || v === 'transparent') return null;
  if (v === 'currentColor' || v === 'currentcolor') return 'ink';
  if (v.startsWith('url(')) return undefined;
  return SAFE_COLOR.test(v) && v.length <= 40 ? v : undefined;
}

/** Presentation attributes, from the attribute itself or a `style` attribute. */
function styleOf(attrs: Record<string, string>): Record<string, string> {
  const style: Record<string, string> = {};
  for (const key of ['fill', 'stroke', 'stroke-width', 'display', 'visibility']) {
    if (attrs[key] !== undefined) style[key] = attrs[key]!;
  }
  for (const part of (attrs.style ?? '').split(';')) {
    const [key, value] = part.split(':');
    if (key && value !== undefined) style[key.trim()] = value.trim();
  }
  return style;
}

const shapePath = (tag: Tag): string | undefined => {
  const a = tag.attrs;
  switch (tag.name) {
    case 'path':
      return a.d;
    case 'rect': {
      const x = num(a.x);
      const y = num(a.y);
      const w = num(a.width);
      const h = num(a.height);
      if (w <= 0 || h <= 0) return undefined;
      const rx = Math.min(num(a.rx, num(a.ry)), w / 2);
      const ry = Math.min(num(a.ry, num(a.rx)), h / 2);
      if (rx > 0 && ry > 0) {
        return `M ${x + rx} ${y} L ${x + w - rx} ${y} A ${rx} ${ry} 0 0 1 ${x + w} ${y + ry} L ${x + w} ${y + h - ry} A ${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h} L ${x + rx} ${y + h} A ${rx} ${ry} 0 0 1 ${x} ${y + h - ry} L ${x} ${y + ry} A ${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`;
      }
      return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
    }
    case 'circle':
    case 'ellipse': {
      const cx = num(a.cx);
      const cy = num(a.cy);
      const rx = tag.name === 'circle' ? num(a.r) : num(a.rx);
      const ry = tag.name === 'circle' ? num(a.r) : num(a.ry);
      if (rx <= 0 || ry <= 0) return undefined;
      return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
    }
    case 'line':
      return `M ${num(a.x1)} ${num(a.y1)} L ${num(a.x2)} ${num(a.y2)}`;
    case 'polyline':
    case 'polygon': {
      const points = (a.points ?? '')
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
      if (points.length < 4 || points.length % 2 || points.some((p) => !Number.isFinite(p))) {
        return undefined;
      }
      const lines = points
        .map((p, i) => (i % 2 ? '' : `${i === 0 ? 'M' : 'L'} ${p} ${points[i + 1]}`))
        .filter(Boolean)
        .join(' ');
      return tag.name === 'polygon' ? `${lines} Z` : lines;
    }
    default:
      return undefined;
  }
};

const DRAWN = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const SKIPPED_NOTES: Record<string, string> = {
  text: 'text (convert it to outlines)',
  image: 'embedded images',
  use: 'symbol references',
  lineargradient: 'gradients',
  radialgradient: 'gradients',
  pattern: 'patterns',
  mask: 'masks',
  clippath: 'clip paths',
  filter: 'filters',
};

export function importSvg(source: string): SvgImport {
  if (Buffer.byteLength(source) > SVG_IMPORT_LIMITS.maxBytes) {
    return { ok: false, message: `the file is over ${SVG_IMPORT_LIMITS.maxBytes / 1024} KB` };
  }
  if (!/<svg[\s>]/i.test(source)) return { ok: false, message: 'this is not an SVG file' };
  if (/<script|<foreignObject|\son[a-z]+\s*=|javascript:/i.test(source)) {
    return {
      ok: false,
      message: 'the file has scripts or embedded content, which Reelcraft will not accept',
    };
  }
  const all = tags(source);
  const root = all.find((tag) => tag.name === 'svg' && !tag.closing);
  if (!root) return { ok: false, message: 'this is not an SVG file' };

  const box = (root.attrs.viewBox ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  let minX = 0;
  let minY = 0;
  let width = num(root.attrs.width);
  let height = num(root.attrs.height);
  if (box.length === 4 && box.every(Number.isFinite) && box[2]! > 0 && box[3]! > 0) {
    [minX, minY, width, height] = box as [number, number, number, number];
  }
  if (!(width > 0 && height > 0)) {
    return {
      ok: false,
      message: 'the file has no size: it needs a viewBox, or a width and height',
    };
  }
  const shrink = Math.min(1, SVG_IMPORT_LIMITS.maxSize / Math.max(width, height));
  const base: Matrix = [shrink, 0, 0, shrink, -minX * shrink, -minY * shrink];
  const viewBox = {
    width: Math.max(1, Math.round(width * shrink * 100) / 100),
    height: Math.max(1, Math.round(height * shrink * 100) / 100),
  };

  const limits: PathLimits = {
    width: viewBox.width,
    height: viewBox.height,
    margin: 0.5,
    maxChars: SVG_IMPORT_LIMITS.maxPathChars,
    maxSegments: SVG_IMPORT_LIMITS.maxSegmentsPerPath,
    minExtent: 0.1,
  };
  const loose: PathLimits = {
    ...limits,
    width: 1e6,
    height: 1e6,
    margin: 10,
    maxChars: SVG_IMPORT_LIMITS.maxPathChars * 4,
    minExtent: 0,
  };

  const strokes: ImportedStroke[] = [];
  const skipped = new Set<string>();
  const stack: Array<{ matrix: Matrix; style: Record<string, string>; hidden: boolean }> = [
    { matrix: base, style: {}, hidden: false },
  ];
  // Content of <defs>, <clipPath> and the like is never drawn on its own.
  let inert = 0;
  const INERT = new Set([
    'defs',
    'clippath',
    'mask',
    'symbol',
    'pattern',
    'lineargradient',
    'radialgradient',
    'filter',
    'style',
    'title',
    'desc',
    'metadata',
  ]);

  for (const tag of all) {
    if (tag === root) continue;
    if (tag.closing) {
      if (INERT.has(tag.name)) inert = Math.max(0, inert - 1);
      else if (tag.name === 'g' || tag.name === 'a' || tag.name === 'svg') {
        if (stack.length > 1) stack.pop();
      }
      continue;
    }
    if (INERT.has(tag.name)) {
      if (SKIPPED_NOTES[tag.name]) skipped.add(SKIPPED_NOTES[tag.name]!);
      if (!tag.selfClosing) inert += 1;
      continue;
    }
    const parent = stack[stack.length - 1]!;
    const own = parseTransform(tag.attrs.transform);
    if ('error' in own) return { ok: false, message: own.error };
    const style = { ...parent.style, ...styleOf(tag.attrs) };
    const matrix = multiply(parent.matrix, own);
    const hidden = parent.hidden || style.display === 'none' || style.visibility === 'hidden';
    if (tag.name === 'g' || tag.name === 'a' || tag.name === 'svg') {
      if (!tag.selfClosing) stack.push({ matrix, style, hidden });
      continue;
    }
    if (inert > 0) continue;
    if (!DRAWN.has(tag.name)) {
      if (SKIPPED_NOTES[tag.name]) skipped.add(SKIPPED_NOTES[tag.name]!);
      continue;
    }
    if (hidden) continue;
    const raw = shapePath(tag);
    if (!raw) continue;

    const plain = parseStrictPath(raw, loose);
    if (!isParsed(plain)) {
      return { ok: false, message: `a ${tag.name} could not be read: ${plain.message}` };
    }
    const moved = transformPath(plain.d, matrix);
    if (typeof moved !== 'string') return { ok: false, message: moved.error };
    const final = parseStrictPath(moved, limits);
    if (!isParsed(final)) {
      // Parts outside the picture or too small to see are left out rather than refusing the file.
      if (final.code === 'out_of_bounds' || final.code === 'too_small') continue;
      return { ok: false, message: `a ${tag.name} could not be used: ${final.message}` };
    }

    const stroke = colorOf(style.stroke);
    let fill = colorOf(style.fill);
    // SVG's default fill is black, but only when nothing else says otherwise.
    if (fill === undefined && style.fill === undefined) fill = stroke ? null : '#000000';
    const strokeWidth = num(style['stroke-width'], 1) * matrix[0]!;
    const relative = strokeWidth / Math.max(viewBox.width, viewBox.height);
    const item: ImportedStroke = { d: final.d };
    if (stroke) item.color = stroke;
    if (fill) item.fill = fill;
    if (stroke) item.weight = relative < 0.008 ? 'thin' : relative > 0.03 ? 'bold' : 'normal';
    if (!stroke && !fill) continue;
    strokes.push(item);
    if (strokes.length > SVG_IMPORT_LIMITS.maxStrokes) {
      return {
        ok: false,
        message: `the drawing has more than ${SVG_IMPORT_LIMITS.maxStrokes} shapes; simplify it or merge shapes into fewer paths`,
      };
    }
  }
  if (!strokes.length) {
    return {
      ok: false,
      message: skipped.size
        ? `nothing in the file can be drawn (it has ${[...skipped].join(', ')})`
        : 'the file has no shapes Reelcraft can draw',
    };
  }
  return { ok: true, viewBox, strokes, skipped: [...skipped] };
}
