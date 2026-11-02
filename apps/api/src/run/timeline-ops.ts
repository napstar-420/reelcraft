import { z } from 'zod';
import { Timeline, TimelineItem, Track } from '@reelcraft/shared';

/** Small, checkable edits to a timeline, the way a person makes them in the editor. The assistant
 * sends a list of these instead of a whole new timeline, so it can't drop what it didn't mean to
 * touch. Items are addressed by their track and their position on it (0-based, in the order
 * `get_timeline` lists them). Ops apply in order, so a later op sees the earlier ones' result. */

const ItemRef = z.object({
  trackId: z.string().min(1),
  index: z.number().int().min(0),
});

const sec = z.number().finite();

export const TimelineOp = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_item'),
    trackId: z.string().min(1),
    item: z.record(z.unknown()),
  }),
  z.object({
    op: z.literal('update_item'),
    at: ItemRef,
    /** Fields to set, merged into the item. */
    set: z.record(z.unknown()).default({}),
    /** Fields to remove (back to their default). */
    unset: z.array(z.string().min(1)).max(20).optional(),
  }),
  z.object({ op: z.literal('remove_item'), at: ItemRef }),
  z.object({
    op: z.literal('move_item'),
    at: ItemRef,
    toTrackId: z.string().min(1).optional(),
    startSec: sec.min(0).optional(),
  }),
  z.object({ op: z.literal('split'), at: ItemRef, atSec: sec.positive() }),
  z.object({
    op: z.literal('shift'),
    trackId: z.string().min(1),
    /** Items starting at or after this time move... */
    fromSec: sec.min(0),
    /** ...by this much (negative moves them earlier). */
    bySec: sec,
  }),
  z.object({
    op: z.literal('add_track'),
    id: z.string().min(1).max(80),
    type: Track.shape.type,
    duckUnder: z.string().min(1).optional(),
  }),
  z.object({ op: z.literal('remove_track'), trackId: z.string().min(1) }),
  z.object({
    op: z.literal('set_canvas'),
    width: z.number().int().positive().max(8192).optional(),
    height: z.number().int().positive().max(8192).optional(),
    fps: z.number().positive().max(120).optional(),
    background: z.string().min(1).max(40).optional(),
  }),
]);
export type TimelineOp = z.infer<typeof TimelineOp>;

export const TIMELINE_OP_NAMES = TimelineOp.options.map((o) => o.shape.op.value);

export class TimelineOpError extends Error {}

type Item = TimelineItem;
type Draft = {
  tracks: Array<{ id: string; type: string; duckUnder?: string; items: Item[] }>;
} & Record<string, unknown>;

const round = (n: number) => Math.round(n * 1000) / 1000;

/** How long an item lasts on the timeline, when that's known without probing its file. */
export function itemDurationSec(item: Item): number | undefined {
  return 'durationSec' in item ? item.durationSec : undefined;
}

function startOf(item: Item): number {
  return item.startSec ?? 0;
}

function sortTrack(items: Item[]): Item[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => startOf(a.item) - startOf(b.item) || a.i - b.i)
    .map((x) => x.item);
}

function trackOf(draft: Draft, trackId: string) {
  const track = draft.tracks.find((t) => t.id === trackId);
  if (!track) {
    const ids = draft.tracks.map((t) => t.id).join(', ') || 'none';
    throw new TimelineOpError(`There is no track "${trackId}" (tracks: ${ids}).`);
  }
  return track;
}

function itemAt(draft: Draft, at: { trackId: string; index: number }) {
  const track = trackOf(draft, at.trackId);
  const item = track.items[at.index];
  if (!item) {
    throw new TimelineOpError(
      `Track "${at.trackId}" has ${track.items.length} item${track.items.length === 1 ? '' : 's'}; there is no item ${at.index}.`,
    );
  }
  return { track, item };
}

function parseItem(raw: unknown, where: string): Item {
  const parsed = TimelineItem.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const path = issue.path.length ? ` (${issue.path.join('.')})` : '';
    throw new TimelineOpError(`${where}: ${issue.message}${path}`);
  }
  return parsed.data;
}

function applyOne(draft: Draft, op: TimelineOp): string {
  switch (op.op) {
    case 'add_item': {
      const track = trackOf(draft, op.trackId);
      const item = parseItem(op.item, 'The new item is not valid');
      track.items = sortTrack([...track.items, item]);
      return `added a ${item.type} item to ${track.id} at ${round(startOf(item))}s`;
    }
    case 'update_item': {
      const { track, item } = itemAt(draft, op.at);
      if ('type' in op.set && op.set.type !== item.type) {
        throw new TimelineOpError(
          'An item cannot change its type: remove it and add a new one instead.',
        );
      }
      const next: Record<string, unknown> = { ...item, ...op.set };
      for (const key of op.unset ?? []) {
        if (key === 'type') throw new TimelineOpError('An item always has a type.');
        delete next[key];
      }
      const updated = parseItem(next, `Item ${op.at.index} on ${track.id} would not be valid`);
      track.items[op.at.index] = updated;
      track.items = sortTrack(track.items);
      const fields = [...Object.keys(op.set), ...(op.unset ?? [])].join(', ');
      return `changed ${fields || 'nothing'} on ${track.id} item ${op.at.index}`;
    }
    case 'remove_item': {
      const { track, item } = itemAt(draft, op.at);
      track.items.splice(op.at.index, 1);
      return `removed the ${item.type} item at ${round(startOf(item))}s from ${track.id}`;
    }
    case 'move_item': {
      const { track, item } = itemAt(draft, op.at);
      if (op.toTrackId === undefined && op.startSec === undefined) {
        throw new TimelineOpError('move_item needs toTrackId, startSec or both.');
      }
      if (op.startSec !== undefined && item.type === 'captions' && item.pages) {
        throw new TimelineOpError(
          'Captions with their own pages follow the words spoken; change the pages instead.',
        );
      }
      const moved = {
        ...item,
        ...(op.startSec !== undefined && { startSec: op.startSec }),
      } as Item;
      const target = op.toTrackId ? trackOf(draft, op.toTrackId) : track;
      track.items.splice(op.at.index, 1);
      target.items = sortTrack([...target.items, moved]);
      return `moved the ${item.type} item to ${target.id} at ${round(startOf(moved))}s`;
    }
    case 'split': {
      const { track, item } = itemAt(draft, op.at);
      if (item.type === 'captions') {
        throw new TimelineOpError('Captions cannot be split; change their pages instead.');
      }
      const duration = itemDurationSec(item);
      if (duration === undefined) {
        throw new TimelineOpError(
          'This clip plays to its natural length; set its durationSec first, then split it.',
        );
      }
      const start = startOf(item);
      const offset = op.atSec - start;
      if (offset <= 0.01 || offset >= duration - 0.01) {
        throw new TimelineOpError(
          `${op.atSec}s is not inside the item (it runs ${round(start)}s to ${round(start + duration)}s).`,
        );
      }
      const first = { ...item, durationSec: round(offset) } as Item;
      const second = { ...item, startSec: round(op.atSec), durationSec: round(duration - offset) };
      if ('id' in second && second.id) (second as { id?: string }).id = `${second.id}-b`;
      if (item.type === 'media') {
        const media = second as Extract<Item, { type: 'media' }>;
        media.trimInSec = round((item.trimInSec ?? 0) + offset);
        // the cut is a plain cut: the first part doesn't leave and the second doesn't arrive
        delete (first as Extract<Item, { type: 'media' }>).transitionOut;
        delete (first as Extract<Item, { type: 'media' }>).fadeOutSec;
        delete media.transitionIn;
        delete media.fadeInSec;
        delete media.reveal;
      }
      track.items.splice(op.at.index, 1, first, second as Item);
      track.items = sortTrack(track.items);
      return `split the ${item.type} item on ${track.id} at ${round(op.atSec)}s`;
    }
    case 'shift': {
      const track = trackOf(draft, op.trackId);
      let moved = 0;
      track.items = track.items.map((item) => {
        if (startOf(item) < op.fromSec - 1e-9) return item;
        if (item.type === 'captions' && item.pages) {
          throw new TimelineOpError(
            'Captions with their own pages follow the words spoken and cannot be shifted.',
          );
        }
        const startSec = round(startOf(item) + op.bySec);
        if (startSec < 0) {
          throw new TimelineOpError(
            `Shifting by ${op.bySec}s would start an item before 0s; shift by less.`,
          );
        }
        moved += 1;
        return { ...item, startSec } as Item;
      });
      track.items = sortTrack(track.items);
      return `shifted ${moved} item${moved === 1 ? '' : 's'} on ${track.id} by ${op.bySec}s from ${op.fromSec}s`;
    }
    case 'add_track': {
      if (draft.tracks.some((t) => t.id === op.id)) {
        throw new TimelineOpError(`There is already a track "${op.id}".`);
      }
      draft.tracks.push({
        id: op.id,
        type: op.type,
        ...(op.duckUnder && { duckUnder: op.duckUnder }),
        items: [],
      });
      return `added the ${op.type} track ${op.id}`;
    }
    case 'remove_track': {
      const track = trackOf(draft, op.trackId);
      const ducking = draft.tracks.find((t) => t.duckUnder === track.id);
      if (ducking) {
        throw new TimelineOpError(
          `Track "${ducking.id}" ducks under "${track.id}": change that first.`,
        );
      }
      draft.tracks = draft.tracks.filter((t) => t !== track);
      return `removed the track ${track.id} and its ${track.items.length} item${track.items.length === 1 ? '' : 's'}`;
    }
    case 'set_canvas': {
      const canvas = draft.canvas as Record<string, unknown>;
      const set = Object.fromEntries(
        Object.entries(op).filter(([key, v]) => key !== 'op' && v !== undefined),
      );
      if (!Object.keys(set).length) throw new TimelineOpError('set_canvas needs a field to set.');
      draft.canvas = { ...canvas, ...set };
      return `set the canvas ${Object.entries(set)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')}`;
    }
  }
}

/** Applies ops to a copy of the timeline. All or nothing: the first op that doesn't fit, or a
 * result that isn't a valid timeline, throws a `TimelineOpError` saying which and why. */
export function applyTimelineOps(
  timeline: Timeline,
  ops: TimelineOp[],
): { timeline: Timeline; changes: string[] } {
  const draft = structuredClone(timeline) as unknown as Draft;
  const changes: string[] = [];
  for (const [i, op] of ops.entries()) {
    try {
      changes.push(applyOne(draft, op));
    } catch (error) {
      if (error instanceof TimelineOpError) {
        throw new TimelineOpError(`Op ${i + 1} (${op.op}): ${error.message}`);
      }
      throw error;
    }
  }
  const parsed = Timeline.safeParse(draft);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || 'timeline'}: ${issue.message}`);
    throw new TimelineOpError(`The edited timeline would not be valid: ${issues.join('; ')}`);
  }
  return { timeline: parsed.data, changes };
}

/** One line per item, for the model to read and address: where it sits and what it shows. */
export function outlineTimeline(timeline: Timeline) {
  return {
    canvas: timeline.canvas,
    durationSec: round(timelineEndSec(timeline)),
    tracks: timeline.tracks.map((track) => ({
      id: track.id,
      type: track.type,
      ...(track.duckUnder && { duckUnder: track.duckUnder }),
      items: track.items.map((item, index) => ({ index, ...summarizeItem(item) })),
    })),
    ...(timeline.world && { world: timeline.world }),
    ...(timeline.camera && { cameraKeys: timeline.camera.keys.length }),
    ...(timeline.fonts?.length && { fonts: timeline.fonts.map((f) => f.family) }),
  };
}

/** The latest moment any item with a known length ends. */
export function timelineEndSec(timeline: Timeline): number {
  let end = 0;
  for (const track of timeline.tracks) {
    for (const item of track.items) {
      const d = itemDurationSec(item);
      if (d !== undefined) end = Math.max(end, startOf(item) + d);
      if (item.type === 'captions' && item.pages) {
        for (const page of item.pages) end = Math.max(end, page.words.at(-1)?.endSec ?? 0);
      }
    }
  }
  return end;
}

function summarizeItem(item: Item): Record<string, unknown> {
  const base = {
    type: item.type,
    startSec: round(startOf(item)),
    ...(itemDurationSec(item) !== undefined && { durationSec: round(itemDurationSec(item)!) }),
    ...('id' in item && item.id && { id: item.id }),
  };
  switch (item.type) {
    // the item's own fields, with times rounded and long lists counted
    case 'media':
      return { ...item, ...base, ...(item.keyframes && { keyframes: item.keyframes.length }) };
    case 'text':
      return { ...item, ...base };
    case 'captions': {
      const { pages } = item;
      return {
        ...item,
        ...base,
        ...(pages && {
          pages: pages.length,
          text: pages
            .map((p) => p.words.map((w) => w.text).join(' '))
            .join(' / ')
            .slice(0, 300),
        }),
      };
    }
    case 'graphic':
      return {
        ...base,
        content: item.content.kind,
        ...(item.content.kind === 'text' && { text: item.content.text.slice(0, 120) }),
        box: { x: item.x, y: item.y, w: item.w, h: item.h },
        anim: item.anim.type,
        ...(item.space && { space: item.space }),
      };
    case 'motion':
      return {
        ...base,
        size: `${item.width}x${item.height}`,
        ...(item.notes && { notes: item.notes.slice(0, 200) }),
        ...(item.x !== undefined && { box: { x: item.x, y: item.y, w: item.w, h: item.h } }),
        codeChars: item.code.length,
      };
  }
}
