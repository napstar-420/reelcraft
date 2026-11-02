import { z } from 'zod';
import { confirmChange } from './gate';
import { obj, str } from './json-schemas';
import {
  CAP,
  IMAGES_PER_TURN,
  UNTRUSTED_TAIL,
  capped,
  clip,
  guard,
  shapeChecks,
  shapeQc,
  withNotice,
} from './run-tools';
import type { AssistantTool, ToolOutcome } from './types';

const RUN_ID = str('A run id (from list_runs or the context).', { minLength: 1 });
const handle = (runId: string) => `#${runId.slice(-8).toLowerCase()}`;
const MAX_EVENTS = 40;

// ---- get_attempt -------------------------------------------------------------------------

const AttemptInput = z.object({
  runId: z.string().min(1),
  stageKey: z.string().min(1),
  attemptNo: z.number().int().min(1).optional(),
  itemIndex: z.number().int().min(0).optional(),
});

const getAttempt: AssistantTool<z.infer<typeof AttemptInput>> = {
  name: 'get_attempt',
  kind: 'read',
  description: `One try of a stage in full (the latest when attemptNo is omitted; itemIndex for an item of an iterating stage): the exact prompt that was sent, what it received (its resolved inputs), how it ended, every check and the QC verdict, the review note, cost, duration, and its event log (provider calls, retries, warnings). Use it when get_stage is not enough to say why a stage did what it did.${UNTRUSTED_TAIL}`,
  input: AttemptInput,
  jsonSchema: () =>
    obj(
      {
        runId: RUN_ID,
        stageKey: str('A stage key of that run.', { minLength: 1 }),
        attemptNo: { type: 'integer', minimum: 1, description: 'Which try; omit for the latest.' },
        itemIndex: {
          type: 'integer',
          minimum: 0,
          description: 'The item, for an iterating stage.',
        },
      },
      ['runId', 'stageKey'],
    ),
  async handler(_ctx, deps, input) {
    const all = (await deps.attempts.listStageAttempts(input.runId, input.stageKey)) as Array<{
      id: string;
      attemptNo: number;
      itemIndex: number | null;
    }>;
    const candidates = all.filter(
      (a) => input.itemIndex === undefined || a.itemIndex === input.itemIndex,
    );
    const chosen =
      input.attemptNo === undefined
        ? candidates.reduce<(typeof candidates)[number] | undefined>(
            (best, a) => (!best || a.attemptNo > best.attemptNo ? a : best),
            undefined,
          )
        : candidates.find((a) => a.attemptNo === input.attemptNo);
    if (!chosen) {
      return {
        ok: false,
        error: candidates.length
          ? `No attempt ${input.attemptNo}. Attempts: ${candidates.map((a) => a.attemptNo).join(', ')}.`
          : 'This stage has no attempts (yet).',
      };
    }
    const detail = await deps.attempts.stageAttemptDetail(input.runId, input.stageKey, chosen.id);
    const events = (await deps.attempts.listStageEvents(
      input.runId,
      input.stageKey,
      chosen.id,
    )) as Array<{
      level: string;
      type: string;
      message: string | null;
      data: unknown;
      createdAt: string;
    }>;
    return {
      ok: true,
      result: guard(
        withNotice({
          stageKey: input.stageKey,
          attemptNo: detail.attemptNo,
          ...(detail.itemIndex !== null && { itemIndex: detail.itemIndex }),
          outcome: detail.outcome,
          actor: detail.actor,
          costUsd: detail.costUsd,
          durationMs: detail.durationMs,
          at: detail.createdAt,
          prompt: clip(detail.renderedPrompt, CAP.fullOutput),
          received: capped(detail.resolvedInputs, CAP.data),
          note: clip(detail.reviewNote, CAP.note),
          checks: shapeChecks(detail.checkResults),
          qc: shapeQc(detail.qcVerdict),
          output: detail.artifact
            ? {
                kind: detail.artifact.kind,
                note: 'Read it with get_stage, or look with view_stage_media.',
              }
            : null,
          events: events.slice(-MAX_EVENTS).map((e) => ({
            at: e.createdAt,
            level: e.level,
            type: e.type,
            message: clip(e.message, CAP.checkMessage),
            ...(e.data !== null &&
              e.data !== undefined && { data: capped(e.data, CAP.checkDetails) }),
          })),
          eventsOmitted: Math.max(0, events.length - MAX_EVENTS),
        }),
        CAP.fullResult,
      ),
    };
  },
};

// ---- get_run_memory ----------------------------------------------------------------------

const MemoryInput = z.object({ runId: z.string().min(1), key: z.string().min(1).optional() });

const getRunMemory: AssistantTool<z.infer<typeof MemoryInput>> = {
  name: 'get_run_memory',
  kind: 'read',
  description: `What a run's stages saved to memory for later stages (memory keys from \`writes\`): each key's current value (iterating stages write key#0, key#1…), which stage wrote it, and the keys still to come. key: only that key (and its items). Use it to see what a stage really passed on.${UNTRUSTED_TAIL}`,
  input: MemoryInput,
  jsonSchema: () =>
    obj({ runId: RUN_ID, key: str('Only this memory key (and its items).') }, ['runId']),
  async handler(_ctx, deps, input) {
    const memory = (await deps.memory.listMemory(input.runId)) as {
      current: Record<
        string,
        {
          memKey: string;
          writtenBy: string;
          writtenItem: number | null;
          kind: string;
          data: unknown;
          version: number;
        }
      >;
      expected: Array<{ memKey: string; writtenBy: string }>;
    };
    const matches = (memKey: string) =>
      !input.key || memKey === input.key || memKey.startsWith(`${input.key}#`);
    const entries = Object.values(memory.current).filter((row) => matches(row.memKey));
    return {
      ok: true,
      result: guard(
        withNotice({
          values: entries.slice(0, 60).map((row) => ({
            key: row.memKey,
            writtenBy: row.writtenBy,
            ...(row.writtenItem !== null && { item: row.writtenItem }),
            kind: row.kind,
            version: row.version,
            value: capped(row.data, CAP.data),
          })),
          valuesOmitted: Math.max(0, entries.length - 60),
          stillToCome: memory.expected.filter((e) => matches(e.memKey)),
        }),
        CAP.fullResult,
      ),
    };
  },
};

// ---- listen_to_audio ---------------------------------------------------------------------

const ListenInput = z.object({
  runId: z.string().min(1),
  stageKey: z.string().min(1).optional(),
  itemIndex: z.number().int().min(0).optional(),
});

const listenToAudio: AssistantTool<z.infer<typeof ListenInput>> = {
  name: 'listen_to_audio',
  kind: 'read',
  description: `Hear what a stage made: the transcript of its audio (a voice-over, music, a video's soundtrack) as lines with their start times, plus loudness (mean and peak dB) and silent gaps. Omit stageKey for the run's final video. Use it to check narration against the script, pacing, cut-off words, long silences, and whether music drowns the voice. Transcribed by VoiceStudio (free) when it is running, else Deepgram (paid: asks first in Manual mode).${UNTRUSTED_TAIL}`,
  input: ListenInput,
  jsonSchema: () =>
    obj(
      {
        runId: RUN_ID,
        stageKey: str('A stage key of an audio or video stage; omit for the final video.'),
        itemIndex: { type: 'integer', minimum: 0, description: 'Only this item.' },
      },
      ['runId'],
    ),
  async handler(ctx, deps, input) {
    let blobId: string | null = null;
    let what = 'the final video';
    if (!input.stageKey) {
      const run = await deps.runControl.get(input.runId).catch(() => null);
      if (!run) return { ok: false, error: `There is no run "${input.runId}".` };
      blobId = run.finalVideo?.blobId ?? null;
      if (!blobId) return { ok: false, error: 'This run has no final video yet.' };
    } else {
      const lookup = await deps.runs.media(input.runId, input.stageKey, input.itemIndex);
      if (!lookup) return { ok: false, error: `There is no run "${input.runId}".` };
      if (!lookup.found) {
        return {
          ok: false,
          error: `No stage "${input.stageKey}". Stages: ${lookup.stageKeys.join(', ')}.`,
        };
      }
      const target = lookup.targets.find(
        (t) => (t.kind === 'media.audio' || t.kind === 'media.video') && t.blobId,
      );
      if (!target) {
        return {
          ok: false,
          error: 'This stage has no current audio or video output (pass itemIndex for one item).',
        };
      }
      blobId = target.blobId;
      what = `${input.stageKey}${target.itemIndex !== null ? ` item ${target.itemIndex}` : ''}`;
    }
    const transcriber = await deps.review.transcriber();
    if (!transcriber.available) return { ok: false, error: transcriber.reason };
    if (transcriber.paid) {
      if (ctx.mode === 'plan') {
        return {
          ok: false,
          error:
            'Plan mode: transcribing costs a little (Deepgram, VoiceStudio is not running). Put it in your plan instead.',
        };
      }
      const refused = await confirmChange(ctx, {
        tool: 'listen_to_audio',
        kind: 'action',
        title: `Transcribe ${what} of run ${handle(input.runId)} with Deepgram`,
        details: ['VoiceStudio is not running, so Deepgram transcribes it (about $0.005 a minute)'],
      });
      if (refused) return refused;
    }
    const heard = await deps.review.listen(blobId!, transcriber.by);
    if (!heard) return { ok: false, error: 'The file could not be read.' };
    return {
      ok: true,
      result: guard(
        withNotice({
          heard: what,
          transcribedBy: heard.by,
          costUsd: heard.costUsd,
          durationSec: heard.durationSec,
          loudness: { meanDb: heard.stats.meanVolumeDb, peakDb: heard.stats.maxVolumeDb },
          silences: heard.stats.silences.slice(0, 30),
          lines: heard.lines.slice(0, 300),
          ...(heard.transcript.trim() ? {} : { note: 'No speech was heard (music or silence).' }),
        }),
        CAP.fullResult,
      ),
    };
  },
};

// ---- view_asset --------------------------------------------------------------------------

const AssetInput = z
  .object({
    assetId: z.string().min(1).optional(),
    characterId: z.string().min(1).optional(),
    blobId: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.assetId) !== Boolean(v.characterId && v.blobId), {
    message: 'Give assetId, or characterId with one of its reference blobIds.',
  });

const viewAsset: AssistantTool<z.infer<typeof AssetInput>> = {
  name: 'view_asset',
  kind: 'read',
  description:
    "Look at something in a channel's library: an asset by id (an image as a picture, a video as a contact sheet of frames), or a Character's reference image (characterId plus one of its reference blobIds from get_channel). Counts toward the pictures you may look at in a turn.",
  input: AssetInput,
  jsonSchema: () =>
    obj({
      assetId: str('An asset id from get_channel.'),
      characterId: str('A Character id from get_channel.'),
      blobId: str("One of that Character's reference blobIds."),
    }),
  async handler(ctx, deps, input): Promise<ToolOutcome> {
    if (ctx.imagesShown >= IMAGES_PER_TURN) {
      return {
        ok: false,
        error: `You have already looked at ${IMAGES_PER_TURN} pictures in this turn.`,
      };
    }
    let blobId: string;
    let label: string;
    let kind: 'image' | 'video';
    if (input.assetId) {
      const asset = await deps.assets.get(input.assetId);
      if (asset.kind !== 'media.image' && asset.kind !== 'media.video') {
        return {
          ok: false,
          error: `This asset is ${asset.kind}: only images and videos can be shown.`,
        };
      }
      blobId = asset.blobId;
      label = asset.name;
      kind = asset.kind === 'media.image' ? 'image' : 'video';
    } else {
      const character = await deps.characters.get(input.characterId!);
      const refs = Array.isArray(character.referenceSet)
        ? (character.referenceSet as Array<{ blobId: string }>)
        : [];
      if (!refs.some((r) => r.blobId === input.blobId)) {
        return { ok: false, error: `That is not one of ${character.name}'s reference images.` };
      }
      blobId = input.blobId!;
      label = `${character.name}: reference`;
      kind = 'image';
    }
    const picture =
      kind === 'image'
        ? await deps.media.imageFromBlob(blobId, label)
        : await deps.review.contactSheet(blobId, { count: 6 }).then((sheet) =>
            sheet
              ? {
                  mime: sheet.mime,
                  base64: sheet.base64,
                  label: `${label}: frames at ${sheet.times.join('s, ')}s`,
                }
              : null,
          );
    if (!picture) return { ok: false, error: 'It could not be read.' };
    ctx.imagesShown += 1;
    return {
      ok: true,
      result: {
        shown: [{ position: 1, label: picture.label }],
        note: 'The picture follows in the next message.',
      },
      images: [{ mime: picture.mime, base64: picture.base64 }],
    };
  },
};

export const REVIEW_TOOLS: AssistantTool<never>[] = [
  getAttempt,
  getRunMemory,
  listenToAudio,
  viewAsset,
] as unknown as AssistantTool<never>[];
