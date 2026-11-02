import { z } from 'zod';
import { VideoBreakdown } from '@reelcraft/shared';
import { confirmChange } from './gate';
import { freeObject, obj } from './json-schemas';
import { MediaSource, mediaSourceJson, resolveMedia } from './media-source';
import { IMAGES_PER_TURN, UNTRUSTED_TAIL, guard, withNotice } from './run-tools';
import type { AssistantTool, ToolOutcome } from './types';

const ANALYSIS_RESULT_CHARS = 60_000;

/** "9:16" from a width and height. */
export function aspectOf(width: number | null, height: number | null): string | null {
  if (!width || !height) return null;
  const ratio = width / height;
  const known: Array<[string, number]> = [
    ['9:16', 9 / 16],
    ['16:9', 16 / 9],
    ['1:1', 1],
    ['4:5', 4 / 5],
    ['4:3', 4 / 3],
    ['3:4', 3 / 4],
    ['21:9', 21 / 9],
  ];
  const near = known.find(([, r]) => Math.abs(r - ratio) / r < 0.03);
  return near ? near[0] : `${width}:${height}`;
}

// ---- analyze_video -----------------------------------------------------------------------

const AnalyzeInput = z.object({
  source: MediaSource,
  transcribe: z.boolean().optional(),
});

const analyzeVideo: AssistantTool<z.infer<typeof AnalyzeInput>> = {
  name: 'analyze_video',
  kind: 'read',
  description: `Break a video down to rebuild it: a file the user attached ({attachmentId}), a Library asset, or what a run made. Returns its format (length, size, aspect, fps), every shot (where the picture changes) with its start, end and the words spoken in it, the full timed transcript and speaking pace, loudness every second and whether there is sound between the words (music), plus contact sheets of one keyframe per shot in shot order (the result says which shots each sheet holds). Then describe each shot from the sheets (subject, framing, camera, on-screen text, style) and look closer with view_media {at:[…]} where needed. transcribe=false skips the words. Transcribing uses VoiceStudio (free) or Deepgram (paid: asks first in Manual mode).${UNTRUSTED_TAIL}`,
  input: AnalyzeInput,
  jsonSchema: () =>
    obj(
      {
        source: mediaSourceJson('The video.'),
        transcribe: { type: 'boolean', description: 'Transcribe the narration (default true).' },
      },
      ['source'],
    ),
  async handler(ctx, deps, input): Promise<ToolOutcome> {
    const resolved = await resolveMedia(deps, input.source, ['video']);
    if (!resolved.ok) return resolved;
    let by: 'voicestudio' | 'deepgram' | null = null;
    let transcriptNote: string | undefined;
    if (input.transcribe !== false) {
      const transcriber = await deps.review.transcriber();
      if (!transcriber.available) {
        transcriptNote = `No transcript: ${transcriber.reason}`;
      } else if (transcriber.paid && ctx.mode === 'plan') {
        transcriptNote =
          'No transcript in Plan mode (Deepgram costs a little): put transcribing in your plan.';
      } else {
        if (transcriber.paid) {
          const refused = await confirmChange(ctx, {
            tool: 'analyze_video',
            kind: 'action',
            title: `Transcribe ${resolved.file.label} with Deepgram`,
            details: [
              'VoiceStudio is not running, so Deepgram transcribes it (about $0.005 a minute)',
            ],
          });
          if (refused) return refused;
        }
        by = transcriber.by;
      }
    }
    const analysis = await deps.review.analyze(resolved.file.blobId, by);
    if (!analysis) return { ok: false, error: `${resolved.file.label} could not be read.` };
    const room = Math.max(0, IMAGES_PER_TURN - ctx.imagesShown);
    const sheets = analysis.sheets.slice(0, room);
    ctx.imagesShown += sheets.length;
    const duration = analysis.durationSec ?? 0;
    return {
      ok: true,
      result: guard(
        withNotice({
          analysed: resolved.file.label,
          format: {
            durationSec: analysis.durationSec,
            width: analysis.width,
            height: analysis.height,
            aspectRatio: aspectOf(analysis.width, analysis.height),
            fps: analysis.fps,
            hasAudio: analysis.hasAudio,
          },
          pacing: {
            shots: analysis.shots.length,
            averageShotSec: analysis.shots.length
              ? Math.round((duration / analysis.shots.length) * 100) / 100
              : null,
          },
          shots: analysis.shots.map((s) => ({
            index: s.index,
            startSec: s.startSec,
            endSec: s.endSec,
            ...(s.words !== null && { words: s.words }),
          })),
          transcript: analysis.transcript
            ? {
                by: analysis.transcript.by,
                costUsd: analysis.transcript.costUsd,
                wordsPerMinute: analysis.transcript.wordsPerMinute,
                text: analysis.transcript.text,
                lines: analysis.transcript.lines.slice(0, 200),
              }
            : null,
          ...(transcriptNote && { transcriptNote }),
          soundBetweenWords: analysis.soundBetweenWords,
          loudnessPerSecond: analysis.loudnessPerSecond,
          sheets: sheets.map((sheet, i) => ({
            position: i + 1,
            shots: sheet.shots,
            columns: sheet.columns,
          })),
          ...(analysis.sheets.length > sheets.length && {
            sheetsNotShown: `${analysis.sheets.length - sheets.length} keyframe sheets were not shown (picture limit): look at those shots with view_media {at:[…]} in a new message.`,
          }),
          note: sheets.length
            ? 'The keyframe sheets follow in the next message, in order: each frame is the middle of a shot, left to right, top to bottom.'
            : 'No keyframes shown (picture limit reached).',
        }),
        ANALYSIS_RESULT_CHARS,
      ),
      ...(sheets.length && {
        images: sheets.map((sheet) => ({ mime: sheet.mime, base64: sheet.base64 })),
      }),
    };
  },
};

// ---- save_breakdown ----------------------------------------------------------------------

const SaveBreakdownInput = z.object({
  source: MediaSource,
  breakdown: VideoBreakdown,
});

const saveBreakdown: AssistantTool<z.infer<typeof SaveBreakdownInput>> = {
  name: 'save_breakdown',
  kind: 'read',
  description:
    'Show the user your breakdown of a video as a card they can check before you rebuild it (it plays the video and jumps to each shot): title, summary, format, sections, every shot (startSec, endSec, visual, onScreenText, camera, transition, and make: generate_image | generate_video | motion_graphic | library_asset | reference_frame | text_only | other), narration (script, voice, wordsPerMinute), captions, music, soundEffects, textStyle and pacing. Use the shot times from analyze_video. Saving changes nothing in the app.',
  input: SaveBreakdownInput,
  jsonSchema: () =>
    obj(
      {
        source: mediaSourceJson('The video it describes.'),
        breakdown: freeObject(
          '{ title, summary, format:{aspectRatio, width?, height?, fps?, durationSec}, sections:[{label,startSec,endSec,purpose}], shots:[{index,startSec,endSec,visual,onScreenText?,camera?,transition?,make,notes?}], narration:{present,script?,voice?,wordsPerMinute?}, captions:{present,style?}, music:{present,description?,energy?}, soundEffects:[{atSec,description}], textStyle?, pacing:{shots,averageShotSec,notes?} }',
        ),
      },
      ['source', 'breakdown'],
    ),
  async handler(_ctx, deps, input): Promise<ToolOutcome> {
    const resolved = await resolveMedia(deps, input.source, ['video']);
    if (!resolved.ok) return resolved;
    const { source } = input;
    return {
      ok: true,
      result: {
        status: 'saved',
        shots: input.breakdown.shots.length,
        note: 'The user sees the breakdown as a card. In Manual or Plan mode, ask whether it is right before rebuilding.',
      },
      item: {
        type: 'breakdown',
        payload: {
          source: {
            label: resolved.file.label,
            blobId: resolved.file.blobId,
            ...(source.attachmentId && { attachmentId: source.attachmentId }),
            ...(source.assetId && { assetId: source.assetId }),
            ...(source.runId && { runId: source.runId }),
          },
          breakdown: input.breakdown,
        },
      },
    };
  },
};

// ---- compare_media -----------------------------------------------------------------------

const CompareInput = z.object({
  a: MediaSource,
  b: MediaSource,
  frames: z.number().int().min(2).max(8).optional(),
});

const compareMedia: AssistantTool<z.infer<typeof CompareInput>> = {
  name: 'compare_media',
  kind: 'read',
  description: `Compare two videos side by side, e.g. a reference the user gave (a) and what a run made from it (b): for each, length, size, aspect, number of shots and average shot length, and loudness; plus one contact sheet of each with frames at the same relative moments (frames: 2-8, default 6), so you can judge how close the rebuild is.${UNTRUSTED_TAIL}`,
  input: CompareInput,
  jsonSchema: () =>
    obj(
      {
        a: mediaSourceJson('The first video (the reference).'),
        b: mediaSourceJson('The second video (the rebuild).'),
        frames: { type: 'integer', minimum: 2, maximum: 8, description: 'Frames per sheet.' },
      },
      ['a', 'b'],
    ),
  async handler(ctx, deps, input): Promise<ToolOutcome> {
    if (ctx.imagesShown + 2 > IMAGES_PER_TURN) {
      return {
        ok: false,
        error: `You have already looked at ${IMAGES_PER_TURN} pictures in this turn.`,
      };
    }
    const [a, b] = await Promise.all([
      resolveMedia(deps, input.a, ['video']),
      resolveMedia(deps, input.b, ['video']),
    ]);
    if (!a.ok) return { ok: false, error: `a: ${a.error}` };
    if (!b.ok) return { ok: false, error: `b: ${b.error}` };
    const [factsA, factsB] = await Promise.all([
      deps.review.facts(a.file.blobId),
      deps.review.facts(b.file.blobId),
    ]);
    if (!factsA || !factsB) return { ok: false, error: 'One of the videos could not be read.' };
    const count = input.frames ?? 6;
    const at = (duration: number | null) =>
      Array.from(
        { length: count },
        (_, i) => Math.round((((i + 0.5) * (duration ?? 0)) / count) * 100) / 100,
      );
    const [sheetA, sheetB] = await Promise.all([
      deps.review.contactSheet(a.file.blobId, { at: at(factsA.durationSec) }),
      deps.review.contactSheet(b.file.blobId, { at: at(factsB.durationSec) }),
    ]);
    const images = [sheetA, sheetB].filter((s) => s !== null);
    ctx.imagesShown += images.length;
    const describe = (label: string, f: NonNullable<typeof factsA>) => ({
      label,
      durationSec: f.durationSec,
      size: f.width && f.height ? `${f.width}x${f.height}` : null,
      aspectRatio: aspectOf(f.width, f.height),
      fps: f.fps,
      shots: f.shots,
      averageShotSec: f.averageShotSec,
      loudnessLufs: f.loudnessLufs,
    });
    return {
      ok: true,
      result: withNotice({
        a: describe(a.file.label, factsA),
        b: describe(b.file.label, factsB),
        sheets: [
          ...(sheetA ? [{ position: 1, video: 'a', times: sheetA.times }] : []),
          ...(sheetB ? [{ position: sheetA ? 2 : 1, video: 'b', times: sheetB.times }] : []),
        ],
        note: 'The two contact sheets follow in the next message: a, then b, at the same relative moments.',
      }),
      ...(images.length && {
        images: images.map((s) => ({ mime: s.mime, base64: s.base64 })),
      }),
    };
  },
};

export const BREAKDOWN_TOOLS: AssistantTool<never>[] = [
  analyzeVideo,
  saveBreakdown,
  compareMedia,
] as unknown as AssistantTool<never>[];
