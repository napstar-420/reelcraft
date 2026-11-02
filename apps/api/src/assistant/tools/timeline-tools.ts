import { z } from 'zod';
import type { TimelineChangePayload } from '@reelcraft/shared';
import {
  TIMELINE_OP_NAMES,
  TimelineOp,
  TimelineOpError,
  applyTimelineOps,
  outlineTimeline,
} from '../../run/timeline-ops';
import { confirmChange } from './gate';
import { obj, str } from './json-schemas';
import { IMAGES_PER_TURN, UNTRUSTED_TAIL, sheetPreview, withNotice } from './run-tools';
import { autoWatch } from './watch-tools';
import type { AssistantTool, JsonObject, ToolDeps, ToolOutcome, TurnContext } from './types';

const usd = (n: number) => `$${n.toFixed(2)}`;
const fail = (error: string): ToolOutcome => ({ ok: false, error });

const Where = { runId: z.string().min(1), stageKey: z.string().min(1) };
const WHERE_JSON = {
  runId: str(undefined, { minLength: 1 }),
  stageKey: str(undefined, { minLength: 1 }),
};

type Session = Awaited<ReturnType<ToolDeps['timelines']['session']>>;

const failingChecks = (
  results: Array<{ name: string; pass: boolean; message?: string | undefined }>,
) => results.filter((r) => !r.pass).map((r) => ({ name: r.name, message: r.message ?? '' }));

function itemRef(i: { trackId: string; index: number }) {
  return `${i.trackId}[${i.index}]`;
}

// ---- get_timeline ------------------------------------------------------------------------

const GetTimelineInput = z.object({
  ...Where,
  /** Items to return in full (every field), as {trackId, index}. */
  items: z
    .array(z.object({ trackId: z.string().min(1), index: z.number().int().min(0) }))
    .max(20)
    .optional(),
});

const getTimeline: AssistantTool<z.infer<typeof GetTimelineInput>> = {
  name: 'get_timeline',
  kind: 'read',
  description: `Open a video's timeline to edit: a waiting Human Timeline Edit stage, or a finished Compose Timeline stage. Returns the canvas, tracks with items by index (address them as {trackId, index}), the files and word timings it may use, styles, failing checks and whether it is editable. items: ones to return in full. Fields: read_guide "timeline".${UNTRUSTED_TAIL}`,
  input: GetTimelineInput,
  jsonSchema: () =>
    obj(
      {
        ...WHERE_JSON,
        items: {
          type: 'array',
          maxItems: 20,
          items: obj({ trackId: str(), index: { type: 'integer', minimum: 0 } }, [
            'trackId',
            'index',
          ]),
        },
      },
      ['runId', 'stageKey'],
    ),
  async handler(_ctx, deps, input): Promise<ToolOutcome> {
    const session = await deps.timelines.session(input.runId, input.stageKey);
    const checks = await deps.timelines
      .check(input.runId, input.stageKey, session.timeline)
      .catch(() => ({ results: [] }));
    const full = (input.items ?? []).map((ref) => {
      const track = session.timeline.tracks.find((t) => t.id === ref.trackId);
      return { at: itemRef(ref), item: track?.items[ref.index] ?? null };
    });
    return {
      ok: true,
      result: withNotice({
        stage: session.stageLabel,
        source: session.source,
        editable: !session.readOnly,
        draftRevision: session.draftRevision,
        timeline: outlineTimeline(session.timeline),
        ...(full.length && { items: full }),
        files: session.resources.slice(0, 80).map((r) => ({
          handle: r.handle,
          kind: r.kind,
          ...(r.label && { label: r.label }),
          ...(typeof (r.probe as { durationSec?: unknown })?.durationSec === 'number' && {
            durationSec: Math.round((r.probe as { durationSec: number }).durationSec * 100) / 100,
          }),
        })),
        wordTimings: Object.fromEntries(
          Object.entries(session.timingMaps).map(([handle, map]) => [
            handle,
            {
              durationSec: map.durationSec,
              words: map.words.length,
              transcript: map.transcript.slice(0, 600),
            },
          ]),
        ),
        styles: session.styles.map((s) => `${s.id} (${s.category})`),
        failingChecks: failingChecks(checks.results),
        note: session.readOnly
          ? session.source === 'wait'
            ? 'This edit is no longer waiting: it cannot be changed.'
            : 'The run is still going: its video can be edited once it stops.'
          : session.source === 'wait'
            ? 'Edit with edit_timeline; submit_timeline sends it on and the run carries on.'
            : 'Edit with edit_timeline; submit_timeline replaces the video and re-renders what follows (it costs).',
      }),
    };
  },
};

// ---- edit_timeline -----------------------------------------------------------------------

const EditTimelineInput = z.object({
  ...Where,
  ops: z.array(TimelineOp).min(1).max(40),
  summary: z.string().trim().min(1).max(200),
});

function opsJson(): JsonObject {
  return {
    type: 'array',
    minItems: 1,
    maxItems: 40,
    items: {
      type: 'object',
      properties: { op: { type: 'string', enum: TIMELINE_OP_NAMES } },
      required: ['op'],
    },
  };
}

const editTimeline: AssistantTool<z.infer<typeof EditTimelineInput>> = {
  name: 'edit_timeline',
  kind: 'change',
  description:
    'Change a timeline from get_timeline in small steps, applied in order (indexes shift after an add, remove, move or split). ops: add_item {trackId, item}; update_item {at:{trackId,index}, set?, unset?}; remove_item {at}; move_item {at, toTrackId?, startSec?}; split {at, atSec}; shift {trackId, fromSec, bySec} (ripple); add_track {id, type, duckUnder?}; remove_track {trackId}; set_canvas {width?, height?, fps?, background?}. All or nothing: nothing changes if a step fails or a check newly breaks. The user can undo it.',
  input: EditTimelineInput,
  jsonSchema: () =>
    obj(
      {
        ...WHERE_JSON,
        ops: opsJson(),
        summary: str('The edit in a few words', { minLength: 1, maxLength: 200 }),
      },
      ['runId', 'stageKey', 'ops', 'summary'],
    ),
  async handler(ctx, deps, input): Promise<ToolOutcome> {
    const session = await deps.timelines.session(input.runId, input.stageKey);
    if (session.readOnly) return fail(readOnlyText(session));
    let edited: ReturnType<typeof applyTimelineOps>;
    try {
      edited = applyTimelineOps(session.timeline, input.ops);
    } catch (error) {
      if (error instanceof TimelineOpError) return fail(`${error.message} Nothing was changed.`);
      throw error;
    }
    const [before, after] = await Promise.all([
      deps.timelines.check(input.runId, input.stageKey, session.timeline),
      deps.timelines.check(input.runId, input.stageKey, edited.timeline),
    ]);
    const failedBefore = new Set(failingChecks(before.results).map((c) => c.name));
    const broken = failingChecks(after.results).filter((c) => !failedBefore.has(c.name));
    if (broken.length) {
      return fail(
        `The edit would break these checks, so nothing was changed: ${broken
          .map((c) => `${c.name}: ${c.message}`)
          .join('; ')}`,
      );
    }
    const refused = await confirmChange(ctx, {
      tool: 'edit_timeline',
      kind: 'change',
      title: `Edit the timeline of ${session.stageLabel}: ${input.summary}`,
      details: edited.changes,
    });
    if (refused) return refused;
    const saved = await deps.timelines.save(input.runId, input.stageKey, {
      draftRevision: session.draftRevision,
      timeline: edited.timeline,
    });
    deps.timelineChanged(input.runId, input.stageKey, saved.draftRevision);
    const payload: TimelineChangePayload = {
      kind: 'timeline',
      runId: input.runId,
      stageKey: input.stageKey,
      stageLabel: session.stageLabel,
      summary: input.summary,
      changes: edited.changes,
      before: session.timeline,
      draftRevision: saved.draftRevision,
    };
    const stillFailing = failingChecks(after.results);
    return {
      ok: true,
      result: {
        status: 'saved',
        draftRevision: saved.draftRevision,
        changes: edited.changes,
        ...(stillFailing.length && { failingChecks: stillFailing }),
        note:
          session.source === 'wait'
            ? 'Saved to the draft. Look at it with preview_timeline; submit_timeline when the user wants it sent on.'
            : 'Saved to the draft, not yet to the video: preview_timeline to look, submit_timeline to re-render it.',
      },
      item: { type: 'change', payload },
    };
  },
};

function readOnlyText(session: Session): string {
  return session.source === 'wait'
    ? 'This timeline edit is no longer waiting, so it cannot be changed.'
    : 'The run is still going: its video can be edited once it stops.';
}

// ---- preview_timeline --------------------------------------------------------------------

/** How long preview_timeline waits for the draft render before handing back. */
const PREVIEW_WAIT_MS = 120_000;
const PREVIEW_POLL_MS = 2_000;

const PreviewInput = z.object(Where);

const previewTimeline: AssistantTool<z.infer<typeof PreviewInput>> = {
  name: 'preview_timeline',
  kind: 'action',
  description: `Render a timeline's saved draft as a quick free video and show frames of it, to check edits before submitting. Waits up to 2 minutes; call again if still rendering. Look closer with view_media/listen, source {runId, stageKey, preview: true}.${UNTRUSTED_TAIL}`,
  input: PreviewInput,
  jsonSchema: () => obj(WHERE_JSON, ['runId', 'stageKey']),
  async handler(ctx, deps, input): Promise<ToolOutcome> {
    const session = await deps.timelines.session(input.runId, input.stageKey);
    let render = await deps.timelinePreviews.current(input.runId, input.stageKey);
    const reusable =
      render &&
      render.draftRevision === session.draftRevision &&
      (render.state === 'rendering' || render.state === 'done');
    if (!reusable) render = await deps.timelinePreviews.start(input.runId, input.stageKey);
    const deadline = Date.now() + PREVIEW_WAIT_MS;
    while (render?.state === 'rendering' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, PREVIEW_POLL_MS));
      render = await deps.timelinePreviews.current(input.runId, input.stageKey);
    }
    if (!render || render.state === 'rendering') {
      return {
        ok: true,
        result: { status: 'rendering', note: 'Still rendering: call preview_timeline again.' },
      };
    }
    if (render.state !== 'done') {
      return fail(`The draft render ${render.state}${render.error ? `: ${render.error}` : ''}.`);
    }
    return withPreviewFrames(ctx, deps, input, render.draftRevision);
  },
};

async function withPreviewFrames(
  ctx: TurnContext,
  deps: ToolDeps,
  input: { runId: string; stageKey: string },
  draftRevision: number,
): Promise<ToolOutcome> {
  const video = await deps.timelinePreviews.latestVideo(input.runId, input.stageKey);
  const result = {
    status: 'rendered',
    draftRevision,
    source: { runId: input.runId, stageKey: input.stageKey, preview: true },
  };
  if (!video || ctx.imagesShown >= IMAGES_PER_TURN) {
    return { ok: true, result: withNotice({ ...result, note: 'Look at it with view_media.' }) };
  }
  const [facts, sheet] = await Promise.all([
    deps.review.facts(video.blobId),
    deps.review.contactSheet(video.blobId, { count: 8 }),
  ]);
  if (!sheet) return { ok: true, result: withNotice({ ...result, facts }) };
  ctx.imagesShown += 1;
  const preview = sheetPreview(sheet, 'the draft render');
  return {
    ok: true,
    result: withNotice({
      ...result,
      facts,
      note: `Frames of the draft render follow (at ${sheet.times.join(', ')}s).`,
    }),
    images: [{ mime: preview.mime, base64: preview.base64 }],
  };
}

// ---- submit_timeline ---------------------------------------------------------------------

const SubmitInput = z.object(Where);

const submitTimeline: AssistantTool<z.infer<typeof SubmitInput>> = {
  name: 'submit_timeline',
  kind: 'action',
  description:
    'Send an edited timeline on, only when the user asks. A waiting Human Timeline Edit: the run carries on. A finished Compose Timeline: replaces it and re-renders the stages after it (with their cost). The run is watched.',
  input: SubmitInput,
  jsonSchema: () => obj(WHERE_JSON, ['runId', 'stageKey']),
  async handler(ctx, deps, input): Promise<ToolOutcome> {
    const session = await deps.timelines.session(input.runId, input.stageKey);
    if (session.readOnly) return fail(readOnlyText(session));
    if (session.source === 'wait') {
      const refused = await confirmChange(ctx, {
        tool: 'submit_timeline',
        kind: 'action',
        title: `Submit the edited timeline of ${session.stageLabel}`,
        details: ['The run carries on from here with this timeline'],
      });
      if (refused) return refused;
      await deps.timelines.submit(input.runId, input.stageKey, session.draftRevision);
      const watching = await autoWatch(ctx, deps, input.runId);
      return { ok: true, result: { status: 'submitted', watching } };
    }
    const preview = (await deps.timelines.submit(
      input.runId,
      input.stageKey,
      session.draftRevision,
    )) as { previewToken: string; affectedStageKeys: string[]; estimatedRerunUsd: number };
    const refused = await confirmChange(ctx, {
      tool: 'submit_timeline',
      kind: 'action',
      title: `Save the timeline of ${session.stageLabel} and re-render the video`,
      details: [
        `Re-makes: ${preview.affectedStageKeys.join(', ') || 'nothing else'}`,
        `About ${usd(preview.estimatedRerunUsd)}`,
      ],
      costUsd: preview.estimatedRerunUsd,
    });
    if (refused) return refused;
    await deps.timelines.submit(
      input.runId,
      input.stageKey,
      session.draftRevision,
      preview.previewToken,
    );
    const watching = await autoWatch(ctx, deps, input.runId);
    return {
      ok: true,
      result: {
        status: 'saved; re-rendering',
        rerunning: preview.affectedStageKeys,
        estimatedUsd: preview.estimatedRerunUsd,
        watching,
      },
    };
  },
};

export const TIMELINE_TOOLS: AssistantTool<never>[] = [
  getTimeline,
  editTimeline,
  previewTimeline,
  submitTimeline,
] as unknown as AssistantTool<never>[];
