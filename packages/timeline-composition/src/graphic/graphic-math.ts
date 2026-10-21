import {
  getLength,
  getPointAtLength,
  parsePath,
  reduceInstructions,
  serializeInstructions,
} from '@remotion/paths';
import type { Instruction } from '@remotion/paths';
import type {
  Ease,
  GraphicAnim,
  GraphicContent,
  GraphicKeyframe,
  GraphicShape,
  GraphicStroke,
  TimelineCamera,
  TimelineTheme,
} from '@reelcraft/shared';

/**
 * The maths behind hand-drawn items. Everything here is a pure function of its inputs (time in,
 * numbers out), so the editor preview and the final render draw exactly the same frame, and so
 * it can be tested without a browser. Nothing uses `Math.random` or the clock.
 */

/** What a timeline looks like when it names no theme of its own. */
export const DEFAULT_THEME: TimelineTheme = {
  paper: '#fbfaf5',
  ink: '#1f1f1f',
  highlight: '#ffd84a',
  accents: ['#3b82f6', '#22c55e', '#ef4444'],
  fontHand: 'Caveat',
  fontBody: 'Patrick Hand',
  strokeWidth: 4,
  roughness: 0.35,
  paperTexture: 'paper',
};

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function ease(kind: Ease | undefined, t: number): number {
  const x = clamp01(t);
  switch (kind) {
    case 'in':
      return x * x;
    case 'out':
      return 1 - (1 - x) ** 3;
    case 'in_out':
      return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
    default:
      return x;
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** A colour as CSS: a theme colour by name (`ink`, `accent2`, ...), or the value as given. */
export function resolveColor(
  value: string | undefined,
  theme: TimelineTheme,
  fallback: 'ink' | 'highlight' | 'paper' = 'ink',
): string {
  const name = value ?? fallback;
  switch (name) {
    case 'ink':
      return theme.ink;
    case 'paper':
      return theme.paper;
    case 'highlight':
      return theme.highlight;
    case 'accent1':
    case 'accent2':
    case 'accent3': {
      const index = Number(name.slice(-1)) - 1;
      return theme.accents[index % theme.accents.length] ?? theme.ink;
    }
    default:
      return name;
  }
}

const WEIGHT = { thin: 0.6, normal: 1, bold: 1.7 } as const;

/** A line's width in world units. */
export function strokeWidthFor(weight: GraphicStroke['weight'], theme: TimelineTheme): number {
  return theme.strokeWidth * WEIGHT[weight ?? 'normal'];
}

/* ---------------------------------------------------------------- seeded wobble */

/** A number from a string, the same every time. */
export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A steady stream of numbers from 0 to 1 for a seed (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Makes a path look drawn by hand: straight lines bend a little, and curves wander. `amount` is
 * how far, in the path's own units. The same seed always gives the same path. A path it cannot
 * read is returned unchanged.
 */
export function roughenPath(d: string, seed: string, amount: number): string {
  if (amount <= 0) return d;
  let instructions: ReturnType<typeof reduceInstructions>;
  try {
    instructions = reduceInstructions(parsePath(d));
  } catch {
    return d;
  }
  const random = seededRandom(hashSeed(seed));
  const wobble = (scale = 1) => (random() * 2 - 1) * amount * scale;
  const out: Instruction[] = [];
  let x = 0;
  let y = 0;
  for (const step of instructions) {
    if (step.type === 'M') {
      const nx = step.x + wobble(0.5);
      const ny = step.y + wobble(0.5);
      out.push({ type: 'M', x: round(nx), y: round(ny) });
      x = nx;
      y = ny;
    } else if (step.type === 'L') {
      const nx = step.x + wobble(0.5);
      const ny = step.y + wobble(0.5);
      const dx = nx - x;
      const dy = ny - y;
      const length = Math.hypot(dx, dy) || 1;
      // Bend a straight line into a shallow curve, to the side.
      const px = -dy / length;
      const py = dx / length;
      const bend1 = wobble(1.2);
      const bend2 = wobble(1.2);
      out.push({
        type: 'C',
        cp1x: round(x + dx / 3 + px * bend1),
        cp1y: round(y + dy / 3 + py * bend1),
        cp2x: round(x + (2 * dx) / 3 + px * bend2),
        cp2y: round(y + (2 * dy) / 3 + py * bend2),
        x: round(nx),
        y: round(ny),
      });
      x = nx;
      y = ny;
    } else if (step.type === 'C') {
      const nx = step.x + wobble(0.5);
      const ny = step.y + wobble(0.5);
      out.push({
        type: 'C',
        cp1x: round(step.cp1x + wobble()),
        cp1y: round(step.cp1y + wobble()),
        cp2x: round(step.cp2x + wobble()),
        cp2y: round(step.cp2y + wobble()),
        x: round(nx),
        y: round(ny),
      });
      x = nx;
      y = ny;
    } else {
      out.push({ type: 'Z' });
    }
  }
  return serializeInstructions(out);
}

/* ---------------------------------------------------------------- path length */

const lengthCache = new Map<string, number>();

/** How long a path is, remembered so a frame doesn't measure the same line again. */
export function pathLength(d: string): number {
  const known = lengthCache.get(d);
  if (known !== undefined) return known;
  let length = 0;
  try {
    length = getLength(d);
  } catch {
    length = 0;
  }
  if (!Number.isFinite(length)) length = 0;
  if (lengthCache.size > 5000) lengthCache.clear();
  lengthCache.set(d, length);
  return length;
}

/** How much of each line is drawn at `progress` (0 to 1) of the whole drawing: the lines are
 * drawn one after another, each taking time in proportion to its length. */
export function visibleLengths(lengths: readonly number[], progress: number): number[] {
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let drawn = clamp01(progress) * total;
  return lengths.map((length) => {
    const part = Math.min(Math.max(drawn, 0), length);
    drawn -= length;
    return part;
  });
}

/** Where the pen is while lines are drawn: the end of the line being drawn now. */
export function penPoint(
  paths: readonly string[],
  lengths: readonly number[],
  progress: number,
): { x: number; y: number } | null {
  const visible = visibleLengths(lengths, progress);
  let index = -1;
  visible.forEach((part, i) => {
    if (part > 0) index = i;
  });
  if (index < 0) return null;
  const point = getPointAtLength(paths[index]!, visible[index]!);
  return point ? { x: point.x, y: point.y } : null;
}

/* ---------------------------------------------------------------- animation */

/** How long an animation takes when the item doesn't say. */
export function animDurationSec(
  anim: GraphicAnim,
  content: GraphicContent,
  itemDurationSec: number,
): number {
  const chars = content.kind === 'text' ? content.text.length : 0;
  const natural =
    anim.type === 'draw'
      ? 0.9
      : anim.type === 'handwrite'
        ? Math.max(0.6, chars * 0.06)
        : anim.type === 'type'
          ? Math.max(0.4, typedLength(content) / TYPED_PER_SEC)
          : anim.type === 'pop'
            ? 0.4
            : anim.type === 'highlight'
              ? 0.5
              : anim.type === 'slide'
                ? 0.5
                : anim.type === 'fade'
                  ? 0.4
                  : 0;
  return Math.min(anim.durationSec ?? natural, itemDurationSec);
}

/** How fast words are typed when the animation doesn't say how long it takes. */
export const TYPED_PER_SEC = 18;

/** How many letters (and spaces) typing takes; line breaks come free. */
export function typedLength(content: GraphicContent): number {
  return content.kind === 'text' ? content.text.replace(/\n/g, '').length : 0;
}

/**
 * The words split at the `shown` typed letter: what is typed so far and what is still to come,
 * part by part, so each keeps its look. The rest is still laid out (unseen) so the typed words
 * don't move as more arrive. Line breaks don't count as letters.
 */
export function typedParts<T extends { text: string }>(
  parts: readonly T[],
  shown: number,
): Array<T & { typed: boolean }> {
  const out: Array<T & { typed: boolean }> = [];
  let left = Math.max(0, Math.floor(shown));
  for (const part of parts) {
    let cut = 0;
    while (cut < part.text.length && (left > 0 || part.text[cut] === '\n')) {
      if (part.text[cut] !== '\n') left -= 1;
      cut += 1;
    }
    if (cut > 0) out.push({ ...part, text: part.text.slice(0, cut), typed: true });
    if (cut < part.text.length) out.push({ ...part, text: part.text.slice(cut), typed: false });
  }
  return out;
}

/** A pop: 0 to a bit over full size, then settling to full size. */
export function popScale(t: number): number {
  const x = clamp01(t);
  if (x < 0.6) return 1.1 * ease('out', x / 0.6);
  return 1.1 - 0.1 * ease('in_out', (x - 0.6) / 0.4);
}

export type AnimState = {
  opacity: number;
  scale: number;
  /** Sideways and downward offset, in the item's units. */
  dx: number;
  dy: number;
  /** How much, left to right, is uncovered (a handwriting or marker swipe). */
  reveal: number;
  /** How much of the lines is drawn. */
  draw: number;
  /** How much of the fills has faded in. */
  fill: number;
  /** Whether the pen is moving now. */
  drawing: boolean;
  /** How many letters have been typed (`type`); everything else shows them all. */
  typed: number;
  /** Whether letters are being typed now. */
  typing: boolean;
};

const DONE: AnimState = {
  opacity: 1,
  scale: 1,
  dx: 0,
  dy: 0,
  reveal: 1,
  draw: 1,
  fill: 1,
  drawing: false,
  typed: Number.POSITIVE_INFINITY,
  typing: false,
};

/** What an item looks like `localSec` seconds after it appears. */
export function animState(
  anim: GraphicAnim,
  content: GraphicContent,
  box: { w: number; h: number },
  itemDurationSec: number,
  localSec: number,
): AnimState {
  const duration = animDurationSec(anim, content, itemDurationSec);
  if (anim.type === 'none' || duration <= 0) return { ...DONE };
  const t = clamp01(localSec / duration);
  const p = ease(anim.ease ?? (anim.type === 'draw' ? 'in_out' : 'out'), t);
  const active = t > 0 && t < 1;
  switch (anim.type) {
    case 'draw':
      // Text and a marker highlight have no lines to trace, so they are written or swiped out.
      return content.kind === 'text' || (content.kind === 'shape' && content.shape === 'highlight')
        ? { ...DONE, reveal: p, drawing: active }
        : { ...DONE, draw: p, fill: p >= 1 ? 1 : clamp01((p - 0.8) / 0.2), drawing: active };
    case 'handwrite':
      return { ...DONE, reveal: p, drawing: active };
    case 'type':
      // Typing keeps a steady pace, whatever the ease; anything but words fades in.
      return content.kind === 'text'
        ? { ...DONE, typed: Math.floor(t * typedLength(content) + 1e-9), typing: active }
        : { ...DONE, opacity: p };
    case 'highlight':
      return { ...DONE, reveal: p, drawing: false };
    case 'pop':
      return { ...DONE, scale: popScale(t), opacity: clamp01(t * 4) };
    case 'fade':
      return { ...DONE, opacity: p };
    case 'slide': {
      const horizontal = anim.from === 'left' || anim.from === 'right' || anim.from === undefined;
      const distance = (horizontal ? box.w : box.h) * (1 - p);
      const sign = anim.from === 'right' || anim.from === 'bottom' ? 1 : -1;
      return {
        ...DONE,
        opacity: clamp01(p * 2),
        dx: horizontal ? sign * distance + 0 : 0,
        dy: horizontal ? 0 : sign * distance + 0,
      };
    }
  }
}

/** Small moves after the item has appeared: offset, size, turn and visibility. */
export type KeyframeState = {
  x: number;
  y: number;
  scale: number;
  rotate: number;
  opacity: number;
};

export const NO_KEYFRAMES: KeyframeState = { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 };

export function keyframeState(
  keyframes: readonly GraphicKeyframe[] | undefined,
  localSec: number,
): KeyframeState {
  if (!keyframes?.length) return NO_KEYFRAMES;
  const result: KeyframeState = { ...NO_KEYFRAMES };
  for (const prop of ['x', 'y', 'scale', 'rotate', 'opacity'] as const) {
    const keys = keyframes.filter((key) => key[prop] !== undefined);
    if (!keys.length) continue;
    const next = keys.findIndex((key) => key.atSec > localSec);
    if (next === 0) {
      result[prop] = keys[0]![prop]!;
    } else if (next === -1) {
      result[prop] = keys[keys.length - 1]![prop]!;
    } else {
      const from = keys[next - 1]!;
      const to = keys[next]!;
      const span = to.atSec - from.atSec;
      const t = span > 0 ? ease(to.ease, (localSec - from.atSec) / span) : 1;
      result[prop] = lerp(from[prop]!, to[prop]!, t);
    }
  }
  return result;
}

/* ---------------------------------------------------------------- camera */

export type CameraView = { cx: number; cy: number; zoom: number };

/** Where the camera looks `sec` seconds into the timeline. Zoom is blended on a log scale, so
 * zooming in or out feels even. Before the first key and after the last, it holds still. */
export function cameraAt(camera: TimelineCamera, sec: number): CameraView {
  const keys = camera.keys;
  const next = keys.findIndex((key) => key.atSec > sec);
  if (next === 0) return pick(keys[0]!);
  if (next === -1) return pick(keys[keys.length - 1]!);
  const from = keys[next - 1]!;
  const to = keys[next]!;
  const span = to.atSec - from.atSec;
  const t = span > 0 ? ease(to.ease, (sec - from.atSec) / span) : 1;
  return {
    cx: lerp(from.cx, to.cx, t),
    cy: lerp(from.cy, to.cy, t),
    zoom: Math.exp(lerp(Math.log(from.zoom), Math.log(to.zoom), t)),
  };
}

const pick = (key: { cx: number; cy: number; zoom: number }): CameraView => ({
  cx: key.cx,
  cy: key.cy,
  zoom: key.zoom,
});

/** With no camera: the whole world, fitted to the frame. */
export function wholeWorldView(
  world: { width: number; height: number },
  canvas: { width: number; height: number },
): CameraView {
  return {
    cx: world.width / 2,
    cy: world.height / 2,
    zoom: Math.min(canvas.width / world.width, canvas.height / world.height),
  };
}

/** The CSS that puts the world under the camera. The world element is `transform-origin: 0 0`. */
export function cameraTransform(view: CameraView, canvas: { width: number; height: number }) {
  const x = canvas.width / 2 - view.cx * view.zoom;
  const y = canvas.height / 2 - view.cy * view.zoom;
  return `translate(${round(x)}px, ${round(y)}px) scale(${view.zoom})`;
}

/* ---------------------------------------------------------------- built-in shapes */

/** The lines of a shape, drawn on a `w` by `h` grid. */
export function shapeStrokes(shape: GraphicShape, w: number, h: number): GraphicStroke[] {
  const f = (value: number) => round(value);
  switch (shape) {
    case 'arrow':
      return [
        { d: `M ${f(w * 0.02)} ${f(h * 0.5)} L ${f(w * 0.97)} ${f(h * 0.5)}` },
        {
          d: `M ${f(w * 0.8)} ${f(h * 0.12)} L ${f(w * 0.98)} ${f(h * 0.5)} L ${f(w * 0.8)} ${f(h * 0.88)}`,
        },
      ];
    case 'circle': {
      const cx = w / 2;
      const cy = h / 2;
      const rx = w * 0.46;
      const ry = h * 0.44;
      const k = 0.5523;
      return [
        {
          d: [
            `M ${f(cx)} ${f(cy - ry)}`,
            `C ${f(cx + rx * k)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - ry * k)} ${f(cx + rx)} ${f(cy)}`,
            `C ${f(cx + rx)} ${f(cy + ry * k)} ${f(cx + rx * k)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)}`,
            `C ${f(cx - rx * k)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + ry * k)} ${f(cx - rx)} ${f(cy)}`,
            `C ${f(cx - rx)} ${f(cy - ry * k)} ${f(cx - rx * k)} ${f(cy - ry)} ${f(cx + w * 0.04)} ${f(cy - ry * 1.02)}`,
            `C ${f(cx + rx * 0.5)} ${f(cy - ry * 1.04)} ${f(cx + rx * 0.8)} ${f(cy - ry * 0.8)} ${f(cx + rx * 0.86)} ${f(cy - ry * 0.55)}`,
          ].join(' '),
        },
      ];
    }
    case 'underline':
      return [
        {
          d: `M ${f(w * 0.01)} ${f(h * 0.55)} C ${f(w * 0.2)} ${f(h * 0.2)} ${f(w * 0.3)} ${f(h * 0.9)} ${f(w * 0.5)} ${f(h * 0.5)} S ${f(w * 0.8)} ${f(h * 0.2)} ${f(w * 0.99)} ${f(h * 0.5)}`,
        },
      ];
    case 'box':
      return [
        {
          d: `M ${f(w * 0.01)} ${f(h * 0.05)} L ${f(w * 0.99)} ${f(h * 0.01)} L ${f(w * 0.97)} ${f(h * 0.97)} L ${f(w * 0.02)} ${f(h * 0.99)} L ${f(w * 0.0)} ${f(h * 0.02)}`,
        },
      ];
    case 'highlight':
      return [
        {
          d: `M ${f(w * 0.01)} ${f(h * 0.12)} L ${f(w)} ${f(h * 0.02)} L ${f(w * 0.99)} ${f(h * 0.94)} L 0 ${f(h)} Z`,
          fill: 'highlight',
        },
      ];
    case 'check':
      return [
        {
          d: `M ${f(w * 0.08)} ${f(h * 0.55)} L ${f(w * 0.38)} ${f(h * 0.88)} L ${f(w * 0.94)} ${f(h * 0.12)}`,
        },
      ];
  }
}

/* ---------------------------------------------------------------- connectors */

export type EndBox = { x: number; y: number; w: number; h: number };

/** Where a line from a box's centre towards `toward` leaves the box. */
function boxEdge(box: EndBox, toward: { x: number; y: number }): { x: number; y: number } {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scale = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : box.w / 2 / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : box.h / 2 / Math.abs(dy),
  );
  return { x: cx + dx * Math.min(scale, 1), y: cy + dy * Math.min(scale, 1) };
}

/**
 * The lines of an arrow from one box to another: from the edge of the first, towards the second's
 * centre, to its edge, a small gap short of each. `curve` bends it (positive clockwise, as a share of
 * its length); `head` puts arrowheads at the end, both ends or neither. Units are the boxes' own.
 * Boxes that overlap give no lines.
 */
export function connectorStrokes(
  from: EndBox,
  to: EndBox,
  options: {
    curve?: number | undefined;
    head?: 'end' | 'both' | 'none' | undefined;
    headSize: number;
  },
): GraphicStroke[] {
  const centre = (box: EndBox) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
  let start = boxEdge(from, centre(to));
  let end = boxEdge(to, centre(from));
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const centres = Math.hypot(centre(to).x - centre(from).x, centre(to).y - centre(from).y);
  // The edges cross when the boxes overlap: there is nothing between them to draw.
  const along =
    (centre(to).x - centre(from).x) * (end.x - start.x) +
    (centre(to).y - centre(from).y) * (end.y - start.y);
  if (length < 1 || along <= 0 || centres <= 0) return [];
  const ux = (end.x - start.x) / length;
  const uy = (end.y - start.y) / length;
  const gap = Math.min(length * 0.1, options.headSize * 0.5);
  start = { x: start.x + ux * gap, y: start.y + uy * gap };
  end = { x: end.x - ux * gap, y: end.y - uy * gap };
  const span = length - gap * 2;
  // A clockwise bend (on a screen, where y points down) pushes the middle to the right of travel.
  const bend = (options.curve ?? 0) * span * 0.5;
  const control = {
    x: (start.x + end.x) / 2 - uy * bend,
    y: (start.y + end.y) / 2 + ux * bend,
  };
  const f = (value: number) => round(value);
  const strokes: GraphicStroke[] = [
    {
      d: bend
        ? `M ${f(start.x)} ${f(start.y)} Q ${f(control.x)} ${f(control.y)} ${f(end.x)} ${f(end.y)}`
        : `M ${f(start.x)} ${f(start.y)} L ${f(end.x)} ${f(end.y)}`,
    },
  ];
  const size = Math.min(options.headSize, span * 0.4);
  const arrowhead = (tip: { x: number; y: number }, back: { x: number; y: number }) => {
    const bx = tip.x - back.x;
    const by = tip.y - back.y;
    const norm = Math.hypot(bx, by) || 1;
    const dx = bx / norm;
    const dy = by / norm;
    const baseX = tip.x - dx * size;
    const baseY = tip.y - dy * size;
    const wing = size * 0.6;
    return {
      d: `M ${f(baseX - dy * wing)} ${f(baseY + dx * wing)} L ${f(tip.x)} ${f(tip.y)} L ${f(baseX + dy * wing)} ${f(baseY - dx * wing)}`,
    };
  };
  const head = options.head ?? 'end';
  if (head !== 'none') strokes.push(arrowhead(end, bend ? control : start));
  if (head === 'both') strokes.push(arrowhead(start, bend ? control : end));
  return strokes;
}

/* ---------------------------------------------------------------- picture reveals */

/** The CSS that uncovers a picture `progress` (0 to 1) of the way, for `media` items that should
 * look drawn in. Nothing is returned once it is fully uncovered. */
export function revealLook(
  type: 'wipe_lr' | 'circle' | 'marker',
  progress: number,
): { clipPath?: string; maskImage?: string } {
  const p = clamp01(progress);
  if (p >= 1) return {};
  switch (type) {
    case 'wipe_lr':
      return { clipPath: `inset(0 ${round((1 - p) * 100)}% 0 0)` };
    case 'circle':
      // 75% reaches the corners from the middle.
      return { clipPath: `circle(${round(p * 75)}% at 50% 50%)` };
    case 'marker': {
      const edge = round(p * 108);
      return {
        maskImage: `linear-gradient(90deg, #000 ${round(Math.max(edge - 8, 0))}%, transparent ${edge}%)`,
      };
    }
  }
}
