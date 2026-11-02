import { describe, expect, it } from 'vitest';
import { Timeline, type TimelineItem } from '@reelcraft/shared';
import {
  TimelineOp,
  TimelineOpError,
  applyTimelineOps,
  outlineTimeline,
  timelineEndSec,
} from './timeline-ops';

const base = (): Timeline =>
  Timeline.parse({
    version: 1,
    canvas: { width: 1080, height: 1920, fps: 30 },
    tracks: [
      {
        id: 'video',
        type: 'video',
        items: [
          { type: 'media', handle: 'a', startSec: 0, durationSec: 4 },
          { type: 'media', handle: 'b', startSec: 4, durationSec: 6, trimInSec: 1 },
        ],
      },
      {
        id: 'titles',
        type: 'overlay',
        items: [
          {
            type: 'text',
            text: 'Hello',
            startSec: 1,
            durationSec: 2,
            styleId: 'title',
            position: 'top',
          },
        ],
      },
      { id: 'music', type: 'audio', items: [] },
    ],
  });

const ops = (raw: unknown[]) => raw.map((op) => TimelineOp.parse(op));
const apply = (raw: unknown[], timeline = base()) => applyTimelineOps(timeline, ops(raw));

describe('applyTimelineOps', () => {
  it('adds an item in time order', () => {
    const { timeline, changes } = apply([
      {
        op: 'add_item',
        trackId: 'titles',
        item: {
          type: 'text',
          text: 'First',
          startSec: 0,
          durationSec: 1,
          styleId: 'title',
          position: 'center',
        },
      },
    ]);
    expect(timeline.tracks[1]!.items.map((i) => (i as { text: string }).text)).toEqual([
      'First',
      'Hello',
    ]);
    expect(changes[0]).toContain('added a text item to titles');
  });

  it('updates and unsets fields', () => {
    const { timeline } = apply([
      { op: 'update_item', at: { trackId: 'video', index: 1 }, set: { volume: 0.5 } },
      { op: 'update_item', at: { trackId: 'video', index: 1 }, unset: ['trimInSec'] },
    ]);
    const item = timeline.tracks[0]!.items[1] as { volume?: number; trimInSec?: number };
    expect(item.volume).toBe(0.5);
    expect(item.trimInSec).toBeUndefined();
  });

  it('refuses a type change and an invalid update', () => {
    expect(() =>
      apply([{ op: 'update_item', at: { trackId: 'video', index: 0 }, set: { type: 'text' } }]),
    ).toThrow(/cannot change its type/);
    expect(() =>
      apply([{ op: 'update_item', at: { trackId: 'video', index: 0 }, set: { volume: 9 } }]),
    ).toThrow(TimelineOpError);
  });

  it('removes and moves items, across tracks', () => {
    const { timeline } = apply([
      { op: 'remove_item', at: { trackId: 'video', index: 0 } },
      { op: 'move_item', at: { trackId: 'video', index: 0 }, startSec: 0 },
    ]);
    expect(timeline.tracks[0]!.items).toHaveLength(1);
    expect(timeline.tracks[0]!.items[0]!.startSec).toBe(0);

    const moved = apply([
      { op: 'move_item', at: { trackId: 'video', index: 1 }, toTrackId: 'music', startSec: 2 },
    ]).timeline;
    expect(moved.tracks[2]!.items[0]).toMatchObject({ handle: 'b', startSec: 2 });
  });

  it('refuses an item on a track of the wrong kind', () => {
    expect(() =>
      apply([{ op: 'move_item', at: { trackId: 'titles', index: 0 }, toTrackId: 'music' }]),
    ).toThrow(/not valid on a audio track/);
  });

  it('splits a clip and keeps its picture continuous', () => {
    const { timeline } = apply([{ op: 'split', at: { trackId: 'video', index: 1 }, atSec: 6.5 }]);
    const items = timeline.tracks[0]!.items as Array<{
      startSec: number;
      durationSec: number;
      trimInSec?: number;
    }>;
    expect(items).toHaveLength(3);
    expect(items[1]).toMatchObject({ startSec: 4, durationSec: 2.5, trimInSec: 1 });
    expect(items[2]).toMatchObject({ startSec: 6.5, durationSec: 3.5, trimInSec: 3.5 });
  });

  it('splits keyframed motion so the second part carries on, with ids that stay unique', () => {
    const start = base();
    start.tracks[0]!.items[0] = {
      ...(start.tracks[0]!.items[0] as Extract<TimelineItem, { type: 'media' }>),
      id: 'a',
      startSec: 0,
      durationSec: 4,
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      keyframes: [
        { atSec: 0, scale: 1 },
        { atSec: 4, scale: 2 },
      ],
    } as TimelineItem;
    const { timeline } = apply(
      [
        { op: 'split', at: { trackId: 'video', index: 0 }, atSec: 2 },
        { op: 'split', at: { trackId: 'video', index: 0 }, atSec: 1 },
      ],
      start,
    );
    const items = timeline.tracks[0]!.items as Array<Extract<TimelineItem, { type: 'media' }>>;
    expect(items.map((i) => i.id)).toEqual(['a', 'a-3', 'a-2', undefined]);
    // 0-1 s: 1 → 1.25; 1-2 s: 1.25 → 1.5; 2-4 s: 1.5 → 2, each from its own start
    expect(items[0]!.keyframes).toEqual([
      { atSec: 0, scale: 1 },
      { atSec: 1, scale: 1.25 },
    ]);
    expect(items[1]!.keyframes).toEqual([
      { atSec: 0, scale: 1.25 },
      { atSec: 1, scale: 1.5 },
    ]);
    expect(items[2]!.keyframes).toEqual([
      { atSec: 0, scale: 1.5 },
      { atSec: 2, scale: 2 },
    ]);
  });

  it('refuses to split a drawn graphic or motion item', () => {
    const start = base();
    start.tracks.push({
      id: 'draw',
      type: 'overlay',
      items: [
        {
          type: 'graphic',
          startSec: 0,
          durationSec: 4,
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          content: { kind: 'text', text: 'Hi' },
          anim: { in: 'draw' },
        } as never,
      ],
    });
    expect(() =>
      apply([{ op: 'split', at: { trackId: 'draw', index: 0 }, atSec: 2 }], start),
    ).toThrow(/restart it/);
  });

  it('refuses a split outside the item', () => {
    expect(() => apply([{ op: 'split', at: { trackId: 'video', index: 0 }, atSec: 5 }])).toThrow(
      /not inside the item/,
    );
  });

  it('ripple-shifts a track from a time', () => {
    const { timeline } = apply([{ op: 'shift', trackId: 'video', fromSec: 4, bySec: 1.5 }]);
    expect(timeline.tracks[0]!.items.map((i) => i.startSec)).toEqual([0, 5.5]);
    expect(() => apply([{ op: 'shift', trackId: 'video', fromSec: 0, bySec: -1 }])).toThrow(
      /before 0s/,
    );
  });

  it('adds and removes tracks', () => {
    const { timeline } = apply([
      { op: 'add_track', id: 'sfx', type: 'audio', duckUnder: 'music' },
      { op: 'remove_track', trackId: 'titles' },
    ]);
    expect(timeline.tracks.map((t) => t.id)).toEqual(['video', 'music', 'sfx']);
    expect(() =>
      apply([
        { op: 'add_track', id: 'sfx', type: 'audio', duckUnder: 'music' },
        { op: 'remove_track', trackId: 'music' },
      ]),
    ).toThrow(/ducks under/);
    expect(() => apply([{ op: 'add_track', id: 'video', type: 'video' }])).toThrow(/already/);
  });

  it('sets the canvas', () => {
    const { timeline } = apply([{ op: 'set_canvas', width: 1920, height: 1080 }]);
    expect(timeline.canvas).toMatchObject({ width: 1920, height: 1080, fps: 30 });
  });

  it('is all or nothing and names the failing op', () => {
    const original = base();
    expect(() =>
      apply(
        [
          { op: 'remove_item', at: { trackId: 'video', index: 0 } },
          { op: 'remove_item', at: { trackId: 'nope', index: 0 } },
        ],
        original,
      ),
    ).toThrow(/^Op 2 \(remove_item\): There is no track "nope"/);
    expect(original.tracks[0]!.items).toHaveLength(2);
  });
});

describe('outlineTimeline', () => {
  it('lists every item with its index and the video length', () => {
    const outline = outlineTimeline(base());
    expect(outline.durationSec).toBe(10);
    expect(outline.tracks[0]!.items[1]).toMatchObject({ index: 1, handle: 'b', startSec: 4 });
    expect(timelineEndSec(base())).toBe(10);
  });
});
