import type { Timeline, TimelineResource } from '@reelcraft/shared';

export type SubmitErrorView = { message: string; failures: string[] };

/** Turns a rejected "Submit timeline" request into something the editor can
 * show. The API answers with `{code: 'human_input_check_failed', checkResults}`
 * when timeline checks fail, `{code: 'timeline_invalid', violations}` when the
 * draft doesn't parse, and a plain Nest `{message}` for everything else (for
 * example "The timeline editor is no longer active"). */
export function describeSubmitError(error: unknown): SubmitErrorView {
  const issues =
    error && typeof error === 'object' && 'issues' in error
      ? (error as { issues: unknown }).issues
      : undefined;
  if (issues && typeof issues === 'object' && !Array.isArray(issues)) {
    const body = issues as {
      code?: unknown;
      message?: unknown;
      checkResults?: unknown;
      violations?: unknown;
    };
    if (body.code === 'human_input_check_failed' && Array.isArray(body.checkResults)) {
      const failures = (
        body.checkResults as Array<{ name?: string; pass?: boolean; message?: string }>
      )
        .filter((result) => result.pass === false)
        .map((result) => `${result.name ?? 'check'}: ${result.message ?? 'failed'}`);
      return {
        message: 'The timeline did not pass its checks. Fix these and submit again:',
        failures,
      };
    }
    if (body.code === 'timeline_invalid' && Array.isArray(body.violations)) {
      const failures = (body.violations as Array<{ path?: string; message?: string }>).map(
        (violation) =>
          violation.path
            ? `${violation.path}: ${violation.message ?? ''}`
            : (violation.message ?? ''),
      );
      return { message: 'The timeline is not valid:', failures };
    }
    if (body.code === 'timeline_draft_conflict') {
      return {
        message: 'A newer draft was saved somewhere else. The editor reloaded it; submit again.',
        failures: [],
      };
    }
    if (typeof body.message === 'string') return { message: body.message, failures: [] };
  }
  if (error instanceof Error) return { message: error.message, failures: [] };
  return { message: 'Could not submit the timeline.', failures: [] };
}

function probeDuration(resource: TimelineResource): number | undefined {
  const probe = resource.probe;
  if (probe && typeof probe === 'object' && 'durationSec' in probe) {
    const value = Number((probe as { durationSec: unknown }).durationSec);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

function trackEnd(items: Timeline['tracks'][number]['items']): number {
  return items.reduce(
    (max, item) =>
      item.type === 'media' || item.type === 'text'
        ? Math.max(max, item.startSec + (item.durationSec ?? 1))
        : max,
    0,
  );
}

/** Adds a Media-panel resource to the timeline (mutates `timeline`). Images
 * and videos go at the end of the first video track; audio goes at the end of
 * the first audio track, which is created when the timeline has none. */
export function appendResource(timeline: Timeline, resource: TimelineResource): void {
  const duration = probeDuration(resource);
  if (resource.kind === 'media.audio') {
    let audio = timeline.tracks.find((track) => track.type === 'audio');
    if (!audio) {
      const taken = new Set(timeline.tracks.map((track) => track.id));
      let id = 'audio-main';
      for (let n = 2; taken.has(id); n += 1) id = `audio-main-${n}`;
      audio = { id, type: 'audio', items: [] };
      timeline.tracks.push(audio);
    }
    audio.items.push({
      type: 'media',
      handle: resource.handle,
      startSec: trackEnd(audio.items),
      durationSec: duration ?? 5,
    });
    return;
  }
  const visual = timeline.tracks.find((track) => track.type === 'video');
  if (!visual) return;
  visual.items.push({
    type: 'media',
    handle: resource.handle,
    startSec: trackEnd(visual.items),
    durationSec: duration ?? 5,
    fit: 'cover',
    overflow: 'trim',
  });
}

/** The shortest a clip or title can be made by trimming. */
export const MIN_ITEM_SEC = 0.1;

type TimedItem = Exclude<Timeline['tracks'][number]['items'][number], { type: 'captions' }>;
export type ItemTiming = { startSec: number; durationSec: number; trimInSec: number };

const round = (value: number) => Math.round(value * 1000) / 1000;

/** The length of a media resource from its probe, when known. */
export function resourceDurationSec(resource: TimelineResource | undefined): number | undefined {
  return resource ? probeDuration(resource) : undefined;
}

/** Where an item starts and ends, for the tracks view and drag maths. */
export function itemTiming(item: TimedItem): ItemTiming {
  return {
    startSec: item.startSec,
    durationSec: item.durationSec ?? 1,
    trimInSec: item.type === 'media' ? (item.trimInSec ?? 0) : 0,
  };
}

/** Times a dragged edge snaps to: 0 and the start and end of every other
 * clip or title on any track. */
export function snapTargets(
  timeline: Timeline,
  except: { trackIndex: number; itemIndex: number },
): number[] {
  const targets = new Set<number>([0]);
  timeline.tracks.forEach((track, trackIndex) =>
    track.items.forEach((item, itemIndex) => {
      if (item.type === 'captions') return;
      if (trackIndex === except.trackIndex && itemIndex === except.itemIndex) return;
      const timing = itemTiming(item);
      targets.add(round(timing.startSec));
      targets.add(round(timing.startSec + timing.durationSec));
    }),
  );
  return [...targets];
}

/** Snaps to the nearest target within `thresholdSec`, otherwise to 0.1 s. */
export function snapSec(value: number, targets: number[], thresholdSec = 0.15): number {
  let best: number | undefined;
  for (const target of targets) {
    if (
      Math.abs(target - value) <= thresholdSec &&
      (best === undefined || Math.abs(target - value) < Math.abs(best - value))
    ) {
      best = target;
    }
  }
  return round(best ?? Math.round(value * 10) / 10);
}

/** Moving keeps the length; an item can't start before 0. */
export function moveTo(timing: ItemTiming, startSec: number): ItemTiming {
  return { ...timing, startSec: round(Math.max(0, startSec)) };
}

/** Dragging the left edge: the end stays put, and a media clip's trim-in
 * moves with it (it can't go before the start of the source). */
export function trimStartTo(timing: ItemTiming, startSec: number, isMedia: boolean): ItemTiming {
  const end = timing.startSec + timing.durationSec;
  let start = Math.min(startSec, end - MIN_ITEM_SEC);
  start = Math.max(start, 0);
  if (isMedia) start = Math.max(start, timing.startSec - timing.trimInSec);
  const delta = start - timing.startSec;
  return {
    startSec: round(start),
    durationSec: round(end - start),
    trimInSec: isMedia ? round(timing.trimInSec + delta) : 0,
  };
}

/** Dragging the right edge: a trimmed clip can't run past the end of its
 * source (`sourceSec`), unless its overflow loops, freezes or speeds up. */
export function trimEndTo(timing: ItemTiming, endSec: number, sourceSec?: number): ItemTiming {
  let duration = Math.max(endSec - timing.startSec, MIN_ITEM_SEC);
  if (sourceSec !== undefined) duration = Math.min(duration, sourceSec - timing.trimInSec);
  return { ...timing, durationSec: round(Math.max(duration, MIN_ITEM_SEC)) };
}

/** Fades in and out can't add up to more than the clip. */
export function clampFades(
  durationSec: number,
  fadeInSec: number | undefined,
  fadeOutSec: number | undefined,
): { fadeInSec?: number; fadeOutSec?: number } {
  const fadeIn = Math.max(0, Math.min(fadeInSec ?? 0, durationSec));
  const fadeOut = Math.max(0, Math.min(fadeOutSec ?? 0, durationSec - fadeIn));
  return {
    ...(fadeIn > 0 && { fadeInSec: round(fadeIn) }),
    ...(fadeOut > 0 && { fadeOutSec: round(fadeOut) }),
  };
}
