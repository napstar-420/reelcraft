import type { Timeline, TimelineItem, Track } from '@reelcraft/shared';

export type TimelineBar = {
  key: string;
  label: string;
  startSec: number;
  endSec: number;
  leftPct: number;
  widthPct: number;
  item: TimelineItem;
};

export type TimelineLane = { id: string; type: Track['type']; bars: TimelineBar[] };

export function isTimeline(value: unknown): value is Timeline {
  const v = value as Partial<Timeline> | null;
  return !!v && typeof v === 'object' && !!v.canvas && Array.isArray(v.tracks);
}

export function itemLabel(item: TimelineItem): string {
  if (item.type === 'media') return item.handle;
  if (item.type === 'text') return item.text;
  return `captions · ${item.timingHandle}`;
}

/** Mirrors `timelineDurationSec` in timeline-composition (an item without a
 * duration counts as 1s), except captions, whose length lives in a timing
 * map this view doesn't have — they're drawn to the end of the timeline. */
export function layoutTimeline(timeline: Timeline): { totalSec: number; lanes: TimelineLane[] } {
  const ends = timeline.tracks.flatMap((track) =>
    track.items.map((item) =>
      item.type === 'captions' ? (item.startSec ?? 0) + 1 : item.startSec + (item.durationSec ?? 1),
    ),
  );
  const totalSec = Math.max(0.1, ...ends);
  const pct = (sec: number) => (sec / totalSec) * 100;

  return {
    totalSec,
    lanes: timeline.tracks.map((track) => ({
      id: track.id,
      type: track.type,
      bars: track.items.map((item, index) => {
        const startSec = item.startSec ?? 0;
        const endSec =
          item.type === 'captions' ? totalSec : item.startSec + (item.durationSec ?? 1);
        return {
          key: `${track.id}-${index}`,
          label: itemLabel(item),
          startSec,
          endSec,
          leftPct: pct(startSec),
          widthPct: Math.max(1, pct(endSec - startSec)),
          item,
        };
      }),
    })),
  };
}
