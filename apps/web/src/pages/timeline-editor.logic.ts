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
