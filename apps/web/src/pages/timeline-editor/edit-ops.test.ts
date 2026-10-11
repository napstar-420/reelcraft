import { describe, expect, it } from 'vitest';
import type { Timeline } from '@reelcraft/shared';
import {
  applyTransitionsToTrack,
  clampTransitions,
  closeGaps,
  deleteItem,
  itemUnderPlayhead,
  nudgeItem,
  overlapsOthers,
  reorderItem,
  reorderTargetIndex,
  rippleDelete,
  splitAt,
} from './edit-ops';

const clip = (handle: string, startSec: number, durationSec: number, extra = {}) => ({
  type: 'media' as const,
  handle,
  startSec,
  durationSec,
  ...extra,
});

const timeline = (): Timeline => ({
  version: 1,
  canvas: { width: 1080, height: 1920, fps: 30 },
  tracks: [
    {
      id: 'video',
      type: 'video',
      items: [clip('a', 0, 4), clip('b', 4, 2), clip('c', 6, 3)],
    },
    { id: 'audio', type: 'audio', items: [clip('voice', 0, 9)] },
    {
      id: 'captions',
      type: 'captions',
      items: [{ type: 'captions', timingHandle: 'words', styleId: 'caption.clean' }],
    },
  ],
});

const starts = (t: Timeline, track = 0) =>
  t.tracks[track]!.items.map((item) => (item.type === 'captions' ? -1 : item.startSec));

describe('splitAt', () => {
  it('cuts a clip in two and carries the source on where it left off', () => {
    const base = timeline();
    (base.tracks[0]!.items[0] as { fadeInSec?: number; fadeOutSec?: number }).fadeInSec = 0.5;
    (base.tracks[0]!.items[0] as { fadeInSec?: number; fadeOutSec?: number }).fadeOutSec = 0.5;
    const result = splitAt(base, { trackIndex: 0, itemIndex: 0 }, 1.5)!;
    const [first, second] = result.timeline.tracks[0]!.items;
    expect(first).toMatchObject({ handle: 'a', startSec: 0, durationSec: 1.5, fadeInSec: 0.5 });
    expect(first).not.toHaveProperty('fadeOutSec');
    expect(second).toMatchObject({
      handle: 'a',
      startSec: 1.5,
      durationSec: 2.5,
      trimInSec: 1.5,
      fadeOutSec: 0.5,
    });
    expect(second).not.toHaveProperty('fadeInSec');
    expect(result.selection).toEqual({ trackIndex: 0, itemIndex: 1 });
    // The original is untouched.
    expect(base.tracks[0]!.items).toHaveLength(3);
  });

  it('adds to an existing trim-in', () => {
    const base = timeline();
    base.tracks[1]!.items[0] = clip('voice', 2, 6, { trimInSec: 10 });
    const result = splitAt(base, { trackIndex: 1, itemIndex: 0 }, 5)!;
    expect(result.timeline.tracks[1]!.items[1]).toMatchObject({ startSec: 5, trimInSec: 13 });
  });

  it('refuses to cut at an edge or outside the clip, and never touches captions', () => {
    expect(splitAt(timeline(), { trackIndex: 0, itemIndex: 0 }, 0)).toBeUndefined();
    expect(splitAt(timeline(), { trackIndex: 0, itemIndex: 0 }, 3.95)).toBeUndefined();
    expect(splitAt(timeline(), { trackIndex: 0, itemIndex: 0 }, 5)).toBeUndefined();
    expect(splitAt(timeline(), { trackIndex: 2, itemIndex: 0 }, 1)).toBeUndefined();
  });
});

describe('deleting', () => {
  it('delete leaves a gap, ripple delete closes it', () => {
    expect(starts(deleteItem(timeline(), { trackIndex: 0, itemIndex: 1 })!.timeline)).toEqual([
      0, 6,
    ]);
    expect(starts(rippleDelete(timeline(), { trackIndex: 0, itemIndex: 1 })!.timeline)).toEqual([
      0, 4,
    ]);
  });

  it('ripple delete only moves the same track', () => {
    const result = rippleDelete(timeline(), { trackIndex: 0, itemIndex: 0 })!.timeline;
    expect(starts(result)).toEqual([0, 2]);
    expect(starts(result, 1)).toEqual([0]);
  });

  it('can remove captions', () => {
    const result = deleteItem(timeline(), { trackIndex: 2, itemIndex: 0 })!.timeline;
    expect(result.tracks[2]!.items).toHaveLength(0);
  });
});

describe('reorderItem', () => {
  it('moves a clip and lays the track out end to end again', () => {
    const result = reorderItem(timeline(), { trackIndex: 0, itemIndex: 2 }, 0)!;
    const items = result.timeline.tracks[0]!.items;
    expect(items.map((i) => (i.type === 'media' ? i.handle : ''))).toEqual(['c', 'a', 'b']);
    expect(starts(result.timeline)).toEqual([0, 3, 7]);
    expect(result.selection).toEqual({ trackIndex: 0, itemIndex: 0 });
  });

  it('does nothing when the clip stays where it is', () => {
    expect(reorderItem(timeline(), { trackIndex: 0, itemIndex: 1 }, 1)).toBeUndefined();
  });

  it('clamps the target to the track', () => {
    const result = reorderItem(timeline(), { trackIndex: 0, itemIndex: 0 }, 99)!;
    expect(
      result.timeline.tracks[0]!.items.map((i) => (i.type === 'media' ? i.handle : '')),
    ).toEqual(['b', 'c', 'a']);
  });
});

describe('closeGaps and nudgeItem', () => {
  it('packs a track with gaps', () => {
    const base = timeline();
    (base.tracks[0]!.items[1] as { startSec: number }).startSec = 5;
    (base.tracks[0]!.items[2] as { startSec: number }).startSec = 9;
    expect(starts(closeGaps(base, 0)!.timeline)).toEqual([0, 4, 6]);
  });

  it('nudges a clip but not before zero', () => {
    expect(starts(nudgeItem(timeline(), { trackIndex: 0, itemIndex: 1 }, 0.1)!.timeline)).toEqual([
      0, 4.1, 6,
    ]);
    expect(nudgeItem(timeline(), { trackIndex: 0, itemIndex: 0 }, -0.1)).toBeUndefined();
  });
});

describe('itemUnderPlayhead', () => {
  it('prefers the selected item when the playhead is inside it', () => {
    expect(itemUnderPlayhead(timeline(), { trackIndex: 1, itemIndex: 0 }, 5)).toEqual({
      trackIndex: 1,
      itemIndex: 0,
    });
  });

  it('otherwise takes the clip on the video track', () => {
    expect(itemUnderPlayhead(timeline(), undefined, 5)).toEqual({ trackIndex: 0, itemIndex: 1 });
    expect(itemUnderPlayhead(timeline(), undefined, 20)).toBeUndefined();
  });
});

describe('reorderTargetIndex', () => {
  const sel = { trackIndex: 0, itemIndex: 0 };

  it('stays put while the clip is still on its own slot', () => {
    expect(reorderTargetIndex(timeline(), sel, { startSec: 0.5, durationSec: 4 })).toBeUndefined();
  });

  it('swaps past a neighbour once the clip is dragged over its middle', () => {
    // a (4s) dragged so its centre (5.5s) is past b's centre (5s).
    expect(reorderTargetIndex(timeline(), sel, { startSec: 3.5, durationSec: 4 })).toBe(1);
    expect(reorderTargetIndex(timeline(), sel, { startSec: 9, durationSec: 4 })).toBe(2);
  });

  it('can move a clip to the front', () => {
    expect(
      reorderTargetIndex(
        timeline(),
        { trackIndex: 0, itemIndex: 2 },
        { startSec: 0, durationSec: 3 },
      ),
    ).toBe(0);
  });
});

describe('overlapsOthers', () => {
  const sel = { trackIndex: 0, itemIndex: 0 };

  it('is true when the clip would sit on a neighbour', () => {
    expect(overlapsOthers(timeline(), sel, { startSec: 3, durationSec: 4 })).toBe(true);
  });

  it('is false in the clip’s own slot, in a gap, or just touching a neighbour', () => {
    expect(overlapsOthers(timeline(), sel, { startSec: 0, durationSec: 4 })).toBe(false);
    expect(overlapsOthers(timeline(), sel, { startSec: 20, durationSec: 4 })).toBe(false);
    expect(
      overlapsOthers(timeline(), { trackIndex: 0, itemIndex: 1 }, { startSec: 4, durationSec: 2 }),
    ).toBe(false);
  });
});

describe('applyTransitionsToTrack', () => {
  const sel = { trackIndex: 0, itemIndex: 0 };
  const withTransitions = (): Timeline => {
    const t = timeline();
    const first = t.tracks[0]!.items[0] as {
      transitionIn?: object;
      transitionOut?: object;
    };
    first.transitionIn = { type: 'crossfade', durationSec: 0.5 };
    first.transitionOut = { type: 'slide', durationSec: 0.4 };
    return t;
  };
  const media = (t: Timeline, track: number, index: number) =>
    t.tracks[track]!.items[index] as { transitionIn?: unknown; transitionOut?: unknown };

  it('gives every other clip on the track the same entry and exit', () => {
    const result = applyTransitionsToTrack(withTransitions(), sel)!;
    expect(result.count).toBe(2);
    for (const index of [1, 2]) {
      expect(media(result.timeline, 0, index)).toMatchObject({
        transitionIn: { type: 'crossfade', durationSec: 0.5 },
        transitionOut: { type: 'slide', durationSec: 0.4 },
      });
    }
    expect(result.selection).toEqual(sel);
  });

  it('leaves other tracks and the original timeline alone', () => {
    const base = withTransitions();
    const result = applyTransitionsToTrack(base, sel)!;
    expect(media(result.timeline, 1, 0).transitionIn).toBeUndefined();
    expect(media(base, 0, 1).transitionIn).toBeUndefined();
  });

  it('applies "none" too, clearing the others', () => {
    const base = withTransitions();
    for (const index of [1, 2]) {
      Object.assign(media(base, 0, index), {
        transitionIn: { type: 'wipe', durationSec: 0.3 },
        transitionOut: { type: 'wipe', durationSec: 0.3 },
      });
    }
    delete media(base, 0, 0).transitionIn;
    delete media(base, 0, 0).transitionOut;
    const result = applyTransitionsToTrack(base, sel)!;
    expect(media(result.timeline, 0, 1)).not.toHaveProperty('transitionIn');
    expect(media(result.timeline, 0, 2)).not.toHaveProperty('transitionOut');
  });

  it('shortens both ends on a clip too short to fit them', () => {
    const base = withTransitions();
    (base.tracks[0]!.items[1] as { durationSec: number }).durationSec = 0.6;
    const result = applyTransitionsToTrack(base, sel)!;
    const short = media(result.timeline, 0, 1) as {
      transitionIn: { durationSec: number };
      transitionOut: { durationSec: number };
    };
    expect(short.transitionIn.durationSec + short.transitionOut.durationSec).toBeLessThanOrEqual(
      0.6,
    );
    expect(short.transitionIn.durationSec / short.transitionOut.durationSec).toBeCloseTo(
      0.5 / 0.4,
      1,
    );
  });

  it('does nothing when nothing would change, on audio, or on captions', () => {
    const once = applyTransitionsToTrack(withTransitions(), sel)!;
    expect(applyTransitionsToTrack(once.timeline, sel)).toBeUndefined();
    expect(
      applyTransitionsToTrack(withTransitions(), { trackIndex: 1, itemIndex: 0 }),
    ).toBeUndefined();
    expect(
      applyTransitionsToTrack(withTransitions(), { trackIndex: 2, itemIndex: 0 }),
    ).toBeUndefined();
  });
});

describe('transitions when a clip changes length', () => {
  const clipWith = (durationSec: number) => ({
    type: 'media' as const,
    handle: 'a',
    startSec: 0,
    durationSec,
    transitionIn: { type: 'crossfade' as const, durationSec: 1 },
    transitionOut: { type: 'slide' as const, durationSec: 1 },
  });

  it('clampTransitions shortens both ends to fit, and leaves ones that already fit', () => {
    const short = clipWith(1);
    clampTransitions(short);
    expect(short.transitionIn.durationSec + short.transitionOut.durationSec).toBeLessThanOrEqual(1);
    const long = clipWith(4);
    clampTransitions(long);
    expect(long.transitionIn.durationSec).toBe(1);
    expect(long.transitionOut.durationSec).toBe(1);
  });

  it('splitting gives the first part the entry and the second the exit, each fitted', () => {
    const t: Timeline = {
      version: 1,
      canvas: { width: 1080, height: 1920, fps: 30 },
      tracks: [{ id: 'video', type: 'video', items: [clipWith(4)] }],
    };
    const result = splitAt(t, { trackIndex: 0, itemIndex: 0 }, 0.4)!;
    const [first, second] = result.timeline.tracks[0]!.items as Array<
      ReturnType<typeof clipWith> & { transitionIn?: unknown; transitionOut?: unknown }
    >;
    expect(first).not.toHaveProperty('transitionOut');
    expect(first!.transitionIn!.durationSec).toBeLessThanOrEqual(0.4);
    expect(second).not.toHaveProperty('transitionIn');
    expect(second!.transitionOut).toMatchObject({ type: 'slide', durationSec: 1 });
  });
});
