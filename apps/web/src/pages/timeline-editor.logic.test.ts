import { describe, expect, it } from 'vitest';
import type { Timeline, TimelineResource } from '@reelcraft/shared';
import { appendResource, describeSubmitError } from './timeline-editor.logic';

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
