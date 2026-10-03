import { describe, expect, it } from 'vitest';
import type { Timeline, TimelineResource } from '@reelcraft/shared';
import {
  appendResource,
  clampFades,
  describeSubmitError,
  moveTo,
  snapSec,
  snapTargets,
  trimEndTo,
  trimStartTo,
} from './timeline-editor.logic';

const withIssues = (issues: unknown) => Object.assign(new Error('POST failed: 422'), { issues });

describe('describeSubmitError', () => {
  it('lists the failed timeline checks', () => {
    const view = describeSubmitError(
      withIssues({
        code: 'human_input_check_failed',
        checkResults: [
          { name: 'timeline.schema', pass: true },
          { name: 'timeline.coverage', pass: false, message: 'gap between 4.0s and 5.0s' },
        ],
      }),
    );
    expect(view.message).toMatch(/did not pass its checks/);
    expect(view.failures).toEqual(['timeline.coverage: gap between 4.0s and 5.0s']);
  });

  it('lists schema violations', () => {
    const view = describeSubmitError(
      withIssues({
        code: 'timeline_invalid',
        violations: [{ path: 'tracks.0.items.1.durationSec', message: 'Too small' }],
      }),
    );
    expect(view.failures).toEqual(['tracks.0.items.1.durationSec: Too small']);
  });

  it("uses the server's message for other rejections", () => {
    expect(
      describeSubmitError(withIssues({ message: 'The timeline editor is no longer active' })),
    ).toEqual({ message: 'The timeline editor is no longer active', failures: [] });
  });

  it('falls back to the error message', () => {
    expect(describeSubmitError(new Error('offline')).message).toBe('offline');
    expect(describeSubmitError('nope').message).toBe('Could not submit the timeline.');
  });
});

const baseTimeline = (): Timeline => ({
  version: 1,
  canvas: { width: 1080, height: 1920, fps: 30 },
  tracks: [
    {
      id: 'video-main',
      type: 'video',
      items: [{ type: 'media', handle: 'artifact:a', startSec: 0, durationSec: 4 }],
    },
  ],
});

const resource = (kind: TimelineResource['kind'], durationSec?: number): TimelineResource =>
  ({
    handle: `asset:${kind}`,
    kind,
    url: '/x',
    ...(durationSec !== undefined && { probe: { durationSec } }),
  }) as TimelineResource;

describe('appendResource', () => {
  it('adds images and videos to the end of the video track', () => {
    const timeline = baseTimeline();
    appendResource(timeline, resource('media.video', 2.5));
    expect(timeline.tracks[0]!.items[1]).toMatchObject({
      handle: 'asset:media.video',
      startSec: 4,
      durationSec: 2.5,
      fit: 'cover',
    });
  });

  it('puts audio on a new audio track, starting at 0s with its real length', () => {
    const timeline = baseTimeline();
    appendResource(timeline, resource('media.audio', 12));
    expect(timeline.tracks[0]!.items).toHaveLength(1);
    expect(timeline.tracks[1]).toMatchObject({
      id: 'audio-main',
      type: 'audio',
      items: [{ type: 'media', handle: 'asset:media.audio', startSec: 0, durationSec: 12 }],
    });
  });

  it('appends further audio after the existing audio', () => {
    const timeline = baseTimeline();
    appendResource(timeline, resource('media.audio', 3));
    appendResource(timeline, resource('media.audio'));
    expect(timeline.tracks).toHaveLength(2);
    expect(timeline.tracks[1]!.items[1]).toMatchObject({ startSec: 3, durationSec: 5 });
  });
});

describe('drag and trim maths', () => {
  const clip = { startSec: 2, durationSec: 4, trimInSec: 1 };

  it('snaps to nearby clip edges, otherwise to tenths of a second', () => {
    expect(snapSec(5.93, [0, 6])).toBe(6);
    expect(snapSec(5.43, [0, 6])).toBe(5.4);
  });

  it('collects every other edge as a snap target', () => {
    const timeline = baseTimeline();
    timeline.tracks[0]!.items.push({
      type: 'media',
      handle: 'artifact:b',
      startSec: 4,
      durationSec: 2,
    });
    expect(snapTargets(timeline, { trackIndex: 0, itemIndex: 1 }).sort()).toEqual([0, 4]);
  });

  it('moves without going before 0', () => {
    expect(moveTo(clip, 3.5)).toEqual({ ...clip, startSec: 3.5 });
    expect(moveTo(clip, -2).startSec).toBe(0);
  });

  it('trims the start: the end stays, trim-in follows, never past the source start', () => {
    expect(trimStartTo(clip, 2.5, true)).toEqual({
      startSec: 2.5,
      durationSec: 3.5,
      trimInSec: 1.5,
    });
    // Only 1 s of source before the current trim-in.
    expect(trimStartTo(clip, 0, true)).toEqual({ startSec: 1, durationSec: 5, trimInSec: 0 });
    expect(trimStartTo(clip, 10, true).durationSec).toBe(0.1);
  });

  it('trims the end within the source length', () => {
    expect(trimEndTo(clip, 7)).toEqual({ ...clip, durationSec: 5 });
    // Source is 4 s long and 1 s is trimmed off the front: at most 3 s.
    expect(trimEndTo(clip, 9, 4).durationSec).toBe(3);
    expect(trimEndTo(clip, 1).durationSec).toBe(0.1);
  });

  it('keeps fades within the clip', () => {
    expect(clampFades(2, 1.5, 1)).toEqual({ fadeInSec: 1.5, fadeOutSec: 0.5 });
    expect(clampFades(2, 0, 0)).toEqual({});
  });
});
