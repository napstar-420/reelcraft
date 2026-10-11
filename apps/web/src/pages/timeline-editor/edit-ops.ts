import type { Timeline, TimelineItem } from '@reelcraft/shared';
import { itemTiming, MIN_ITEM_SEC } from '../timeline-editor.logic';

export type Selection = { trackIndex: number; itemIndex: number };
/** The result of an edit: the new timeline, and what should be selected after it. */
export type EditResult = { timeline: Timeline; selection?: Selection | undefined };

type Timed = Exclude<TimelineItem, { type: 'captions' }>;

const round = (value: number) => Math.round(value * 1000) / 1000;
const isTimed = (item: TimelineItem | undefined): item is Timed =>
  item !== undefined && item.type !== 'captions';

/** The item at a position, if it exists. */
export function itemAt(timeline: Timeline, selection: Selection): TimelineItem | undefined {
  return timeline.tracks[selection.trackIndex]?.items[selection.itemIndex];
}

/** Splits a clip or title in two at `atSec`. The first part keeps the start of the clip, the
 * second its end; a media clip's second part starts further into its source (`trimInSec`), so
 * the picture and sound carry on exactly where they were. A fade in stays with the first part
 * and a fade out with the second. Returns undefined when `atSec` is not inside the item. */
export function splitAt(
  timeline: Timeline,
  selection: Selection,
  atSec: number,
): EditResult | undefined {
  const item = itemAt(timeline, selection);
  if (!isTimed(item)) return undefined;
  const { startSec, durationSec } = itemTiming(item);
  const at = round(atSec);
  if (at < startSec + MIN_ITEM_SEC || at > startSec + durationSec - MIN_ITEM_SEC) return undefined;

  const next = structuredClone(timeline);
  const track = next.tracks[selection.trackIndex]!;
  const first = track.items[selection.itemIndex] as Timed;
  const second = structuredClone(first);
  const firstLength = round(at - startSec);

  first.durationSec = firstLength;
  second.startSec = at;
  second.durationSec = round(startSec + durationSec - at);
  if (first.type === 'media' && second.type === 'media') {
    second.trimInSec = round((first.trimInSec ?? 0) + firstLength);
    delete first.fadeOutSec;
    delete second.fadeInSec;
    delete second.transitionIn;
  }
  track.items.splice(selection.itemIndex + 1, 0, second);
  return { timeline: next, selection: { ...selection, itemIndex: selection.itemIndex + 1 } };
}

/** Removes an item, leaving a gap where it was. */
export function deleteItem(timeline: Timeline, selection: Selection): EditResult | undefined {
  if (!itemAt(timeline, selection)) return undefined;
  const next = structuredClone(timeline);
  next.tracks[selection.trackIndex]!.items.splice(selection.itemIndex, 1);
  return { timeline: next };
}

/** Removes an item and moves everything after it on the same track earlier by its length, so
 * no gap is left. Captions have no length of their own and are simply removed. */
export function rippleDelete(timeline: Timeline, selection: Selection): EditResult | undefined {
  const item = itemAt(timeline, selection);
  if (!item) return undefined;
  const next = structuredClone(timeline);
  const track = next.tracks[selection.trackIndex]!;
  track.items.splice(selection.itemIndex, 1);
  if (isTimed(item)) {
    const { startSec, durationSec } = itemTiming(item);
    const end = startSec + durationSec;
    for (const other of track.items) {
      if (isTimed(other) && other.startSec >= end - 0.001) {
        other.startSec = round(Math.max(0, other.startSec - durationSec));
      }
    }
  }
  return { timeline: next };
}

/** Lays a track's clips end to end in their current order, starting where the first one starts.
 * Used to close gaps after cutting. */
export function closeGaps(timeline: Timeline, trackIndex: number): EditResult | undefined {
  const track = timeline.tracks[trackIndex];
  if (!track) return undefined;
  const next = structuredClone(timeline);
  const items = next.tracks[trackIndex]!.items;
  const timed = items.filter(isTimed).sort((a, b) => a.startSec - b.startSec);
  let cursor = timed[0]?.startSec ?? 0;
  for (const item of timed) {
    item.startSec = round(cursor);
    cursor += item.durationSec ?? 1;
  }
  items.sort((a, b) => (isTimed(a) && isTimed(b) ? a.startSec - b.startSec : 0));
  return { timeline: next };
}

/** Moves a clip to another place in its track's order and lays the track out end to end again,
 * so dragging a picture between two others reorders the story. `toIndex` counts the clips in
 * time order. */
export function reorderItem(
  timeline: Timeline,
  selection: Selection,
  toIndex: number,
): EditResult | undefined {
  const track = timeline.tracks[selection.trackIndex];
  if (!track) return undefined;
  const ordered = track.items
    .map((item, index) => ({ item, index }))
    .filter((entry): entry is { item: Timed; index: number } => isTimed(entry.item))
    .sort((a, b) => a.item.startSec - b.item.startSec);
  const from = ordered.findIndex((entry) => entry.index === selection.itemIndex);
  if (from === -1) return undefined;
  const target = Math.max(0, Math.min(toIndex, ordered.length - 1));
  if (target === from) return undefined;

  const next = structuredClone(timeline);
  const nextTrack = next.tracks[selection.trackIndex]!;
  const moving = ordered.splice(from, 1)[0]!;
  ordered.splice(target, 0, moving);
  let cursor = Math.min(...ordered.map((entry) => entry.item.startSec));
  const movedItem = nextTrack.items[moving.index] as Timed;
  for (const entry of ordered) {
    const item = nextTrack.items[entry.index] as Timed;
    item.startSec = round(cursor);
    cursor += item.durationSec ?? 1;
  }
  nextTrack.items.sort((a, b) =>
    isTimed(a) && isTimed(b) ? a.startSec - b.startSec : isTimed(a) ? -1 : 1,
  );
  return {
    timeline: next,
    selection: {
      trackIndex: selection.trackIndex,
      itemIndex: nextTrack.items.indexOf(movedItem),
    },
  };
}

/** Where a dragged clip belongs in its track's order, if dropping it at `timing` puts it past the
 * middle of a neighbour: dragging a picture over the next one swaps them. Undefined when it
 * stays in place. */
export function reorderTargetIndex(
  timeline: Timeline,
  selection: Selection,
  timing: { startSec: number; durationSec: number },
): number | undefined {
  const track = timeline.tracks[selection.trackIndex];
  if (!track) return undefined;
  const ordered = track.items
    .map((item, index) => ({ item, index }))
    .filter((entry): entry is { item: Timed; index: number } => isTimed(entry.item))
    .sort((a, b) => a.item.startSec - b.item.startSec);
  const from = ordered.findIndex((entry) => entry.index === selection.itemIndex);
  if (from === -1) return undefined;
  const center = timing.startSec + timing.durationSec / 2;
  const target = ordered
    .filter((entry) => entry.index !== selection.itemIndex)
    .filter((entry) => entry.item.startSec + (entry.item.durationSec ?? 1) / 2 < center).length;
  return target === from ? undefined : target;
}

/** Whether a clip placed at `timing` would sit on top of another clip or title on its track. */
export function overlapsOthers(
  timeline: Timeline,
  selection: Selection,
  timing: { startSec: number; durationSec: number },
): boolean {
  const track = timeline.tracks[selection.trackIndex];
  if (!track) return false;
  const end = timing.startSec + timing.durationSec;
  return track.items.some((other, index) => {
    if (index === selection.itemIndex || !isTimed(other)) return false;
    const { startSec, durationSec } = itemTiming(other);
    return timing.startSec < startSec + durationSec - 0.001 && end > startSec + 0.001;
  });
}

/** Moves a clip or title by `deltaSec` (it can't start before 0). */
export function nudgeItem(
  timeline: Timeline,
  selection: Selection,
  deltaSec: number,
): EditResult | undefined {
  const item = itemAt(timeline, selection);
  if (!isTimed(item)) return undefined;
  const start = round(Math.max(0, item.startSec + deltaSec));
  if (start === item.startSec) return undefined;
  const next = structuredClone(timeline);
  (itemAt(next, selection) as Timed).startSec = start;
  return { timeline: next, selection };
}

/** The clip or title the playhead is on: the selected one if the playhead is inside it,
 * otherwise the topmost one on any track at that time (video track first). */
export function itemUnderPlayhead(
  timeline: Timeline,
  selection: Selection | undefined,
  atSec: number,
): Selection | undefined {
  const inside = (item: TimelineItem | undefined) => {
    if (!isTimed(item)) return false;
    const { startSec, durationSec } = itemTiming(item);
    return atSec > startSec && atSec < startSec + durationSec;
  };
  if (selection && inside(itemAt(timeline, selection))) return selection;
  const order = timeline.tracks
    .map((track, trackIndex) => ({ track, trackIndex }))
    .sort((a, b) => Number(b.track.type === 'video') - Number(a.track.type === 'video'));
  for (const { track, trackIndex } of order) {
    const itemIndex = track.items.findIndex(inside);
    if (itemIndex !== -1) return { trackIndex, itemIndex };
  }
  return undefined;
}
