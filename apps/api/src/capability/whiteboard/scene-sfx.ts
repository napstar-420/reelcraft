import { sfxHandle, sfxInfo } from '@reelcraft/shared';
import type { Timeline, TimelineItem } from '@reelcraft/shared';

type SketchItem = Extract<TimelineItem, { type: 'sketch' }>;
type MediaItem = Extract<TimelineItem, { type: 'media' }>;
type Camera = NonNullable<Timeline['camera']>;

/** How loud the sounds are against the voice (which plays at full volume). */
export const SFX_VOLUME = 0.35;
/** Two sounds closer than this would blur into one, so the later one is dropped. */
const MIN_GAP_SEC = 0.25;
/** Slots whose first appearance marks an answer or an outcome. */
const OUTCOME_SLOTS = new Set(['result', 'solution', 'after']);

const round = (value: number) => Math.round(value * 100) / 100;

/** Which built-in sound goes with an item, from what it is and how it appears. */
export function sfxFor(item: SketchItem): string | undefined {
  const parts = (item.id ?? '').split(':');
  const role = parts[parts.length - 1] ?? '';
  const slot = parts[1] ?? '';
  if (role === 'heading' && OUTCOME_SLOTS.has(slot)) return 'ding';
  if (role === 'connector') return 'swipe';
  if (role === 'emphasis') return 'marker';
  switch (item.anim.type) {
    case 'draw':
      return 'pencil';
    case 'handwrite':
      return 'marker';
    case 'pop':
      return 'pop';
    case 'slide':
      return 'swipe';
    case 'highlight':
      return 'tick';
    default:
      return undefined;
  }
}

/** A sound for each moment a drawing starts and each time the camera moves, at most one
 * every 0.25 s. Only built-in sounds are used, so the result needs no files from the run. */
export function placeSfx(items: readonly SketchItem[], camera: Camera | undefined): MediaItem[] {
  const moments: Array<{ at: number; id: string; priority: number }> = [];
  for (const item of items) {
    const id = sfxFor(item);
    if (id) moments.push({ at: item.startSec, id, priority: id === 'ding' ? 2 : 1 });
  }
  const keys = camera?.keys ?? [];
  for (let index = 1; index < keys.length; index += 1) {
    const from = keys[index - 1]!;
    const to = keys[index]!;
    if (from.cx !== to.cx || from.cy !== to.cy || from.zoom !== to.zoom) {
      moments.push({ at: from.atSec, id: 'whoosh', priority: 2 });
    }
  }
  moments.sort((a, b) => a.at - b.at || b.priority - a.priority);

  const placed: MediaItem[] = [];
  let last = -Infinity;
  for (const moment of moments) {
    if (moment.at - last < MIN_GAP_SEC) continue;
    const info = sfxInfo(moment.id);
    if (!info) continue;
    last = moment.at;
    placed.push({
      type: 'media',
      handle: sfxHandle(moment.id),
      startSec: round(moment.at),
      durationSec: info.durationSec,
      volume: SFX_VOLUME,
    });
  }
  return placed;
}
