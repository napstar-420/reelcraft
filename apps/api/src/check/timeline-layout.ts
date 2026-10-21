/**
 * Layout advice for a timeline: things placed off the frame, words on top of words, things that flash
 * past, words too small to read, and words at the very edge. Pure: it reads only the timeline. The
 * results are advice (passing, with `warning`), because a layout is a judgement call.
 */
import type { Timeline, TimelineItem } from '@reelcraft/shared';
import type { CheckResult } from './check.types';

type Target = { trackId: string; itemIndex: number };
type Box = { x: number; y: number; w: number; h: number };
type Placed = {
  target: Target;
  label: string;
  box: Box;
  space: 'world' | 'screen';
  start: number;
  end: number | undefined;
  /** Letter height, for words. */
  textSize?: number;
};

export const LAYOUT_LIMITS = {
  /** Share of a box that must be inside what it is placed on. */
  visibleShare: 0.9,
  /** Share of the smaller of two word boxes they may share. */
  textOverlapShare: 0.2,
  /** How long two word boxes may share space before it counts. */
  overlapSec: 0.2,
  minOnScreenSec: 1,
  /** Smallest letter height, as a share of the frame's short side. */
  minTextShare: 0.025,
  /** The margin words keep from the frame's edge, as a share of each side. */
  safeMargin: 0.04,
} as const;

const NAMES = [
  'timeline.on_screen',
  'timeline.text_overlap',
  'timeline.min_on_screen',
  'timeline.text_size',
  'timeline.safe_area',
] as const;

export function layoutAdvice(timeline: Timeline): CheckResult[] {
  const placed = placedItems(timeline);
  const frame = { x: 0, y: 0, w: timeline.canvas.width, h: timeline.canvas.height };
  const world = timeline.world
    ? { x: 0, y: 0, w: timeline.world.width, h: timeline.world.height }
    : frame;
  // How many screen pixels one world unit becomes.
  const worldScale = timeline.camera?.keys.length
    ? Math.min(...timeline.camera.keys.map((key) => key.zoom))
    : Math.min(frame.w / world.w, frame.h / world.h);
  const found: Record<(typeof NAMES)[number], Array<{ message: string; targets: Target[] }>> = {
    'timeline.on_screen': [],
    'timeline.text_overlap': [],
    'timeline.min_on_screen': [],
    'timeline.text_size': [],
    'timeline.safe_area': [],
  };

  for (const item of placed) {
    const area = item.space === 'screen' ? frame : world;
    const share = visibleShare(item.box, area);
    if (share < LAYOUT_LIMITS.visibleShare) {
      found['timeline.on_screen'].push({
        message: `${item.label} is ${Math.round((1 - share) * 100)}% outside the ${item.space === 'screen' ? 'frame' : 'world'}`,
        targets: [item.target],
      });
    }
    if (item.end !== undefined && item.end - item.start < LAYOUT_LIMITS.minOnScreenSec) {
      found['timeline.min_on_screen'].push({
        message: `${item.label} shows for only ${(item.end - item.start).toFixed(2)}s`,
        targets: [item.target],
      });
    }
    if (item.textSize !== undefined) {
      const seen = item.textSize * (item.space === 'screen' ? 1 : worldScale);
      const smallest = Math.min(frame.w, frame.h) * LAYOUT_LIMITS.minTextShare;
      if (seen < smallest) {
        found['timeline.text_size'].push({
          message: `${item.label} is ${Math.round(seen)}px tall on screen; ${Math.ceil(smallest)}px or more reads on a phone`,
          targets: [item.target],
        });
      }
      if (item.space === 'screen' && share >= LAYOUT_LIMITS.visibleShare) {
        const mx = frame.w * LAYOUT_LIMITS.safeMargin;
        const my = frame.h * LAYOUT_LIMITS.safeMargin;
        const b = item.box;
        if (b.x < mx || b.y < my || b.x + b.w > frame.w - mx || b.y + b.h > frame.h - my) {
          found['timeline.safe_area'].push({
            message: `${item.label} touches the edge of the frame`,
            targets: [item.target],
          });
        }
      }
    }
  }

  const words = placed.filter((item) => item.textSize !== undefined);
  for (let i = 0; i < words.length; i += 1) {
    for (let j = i + 1; j < words.length; j += 1) {
      const a = words[i]!;
      const b = words[j]!;
      if (a.space !== b.space) continue;
      const together = Math.min(a.end ?? Infinity, b.end ?? Infinity) - Math.max(a.start, b.start);
      if (together <= LAYOUT_LIMITS.overlapSec) continue;
      const shared = intersection(a.box, b.box);
      const smaller = Math.min(a.box.w * a.box.h, b.box.w * b.box.h);
      if (smaller > 0 && shared / smaller > LAYOUT_LIMITS.textOverlapShare) {
        found['timeline.text_overlap'].push({
          message: `${a.label} and ${b.label} are on top of each other`,
          targets: [a.target, b.target],
        });
      }
    }
  }

  return NAMES.map((name) => {
    const list = found[name];
    if (!list.length) return { name, kind: 'builtin', pass: true };
    return {
      name,
      kind: 'builtin',
      pass: true,
      warning: true,
      message: list.map((entry) => entry.message).join('; '),
      targets: list.flatMap((entry) => entry.targets),
    };
  });
}

function placedItems(timeline: Timeline): Placed[] {
  const placed: Placed[] = [];
  for (const track of timeline.tracks) {
    track.items.forEach((item: TimelineItem, itemIndex) => {
      const target = { trackId: track.id, itemIndex };
      if (item.type === 'graphic') {
        placed.push({
          target,
          label: labelOf(item, track.id, itemIndex),
          box: { x: item.x, y: item.y, w: item.w, h: item.h },
          space: item.space ?? 'world',
          start: item.startSec,
          end: item.startSec + item.durationSec,
          ...(item.content.kind === 'text' && { textSize: item.content.size }),
        });
      } else if (
        item.type === 'media' &&
        item.x !== undefined &&
        item.y !== undefined &&
        item.w !== undefined &&
        item.h !== undefined &&
        track.type !== 'audio'
      ) {
        placed.push({
          target,
          label: `clip ${itemIndex + 1} on ${track.id}`,
          box: { x: item.x, y: item.y, w: item.w, h: item.h },
          space: item.space ?? 'world',
          start: item.startSec,
          end: item.durationSec !== undefined ? item.startSec + item.durationSec : undefined,
        });
      }
    });
  }
  return placed;
}

function labelOf(
  item: Extract<TimelineItem, { type: 'graphic' }>,
  trackId: string,
  index: number,
): string {
  if (item.content.kind === 'text') {
    const words =
      item.content.text.length > 30 ? `${item.content.text.slice(0, 30)}…` : item.content.text;
    return `"${words}"`;
  }
  return item.id ? `drawing ${item.id}` : `drawing ${index + 1} on ${trackId}`;
}

function intersection(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function visibleShare(box: Box, area: Box): number {
  const total = box.w * box.h;
  return total > 0 ? intersection(box, area) / total : 1;
}
