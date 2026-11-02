import { z } from 'zod';
import { obj, str } from './json-schemas';
import type { JsonObject, ToolDeps } from './types';

/** Where a picture, video or sound is: a file attached to the chat, a library asset, a Character's
 * reference image, or what a run made (a stage's output, or the final video). Every media tool
 * takes one, so they all work on the same things. */
export const MediaSource = z
  .object({
    attachmentId: z.string().min(1).optional(),
    assetId: z.string().min(1).optional(),
    characterId: z.string().min(1).optional(),
    blobId: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
    stageKey: z.string().min(1).optional(),
    itemIndex: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const kinds = [
      v.attachmentId !== undefined,
      v.assetId !== undefined,
      v.characterId !== undefined,
      v.runId !== undefined,
    ].filter(Boolean).length;
    if (kinds !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Give exactly one of: attachmentId, assetId, characterId (with blobId), or runId (with stageKey and itemIndex as needed).',
      });
    }
    if (v.characterId !== undefined && v.blobId === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'characterId needs blobId.' });
    }
    if (v.blobId !== undefined && v.characterId === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'blobId goes with characterId.' });
    }
    if ((v.stageKey !== undefined || v.itemIndex !== undefined) && v.runId === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'stageKey and itemIndex need runId.' });
    }
  });
export type MediaSource = z.infer<typeof MediaSource>;

export function mediaSourceJson(description: string): JsonObject {
  return obj(
    {
      attachmentId: str('A file the user attached to the chat.'),
      assetId: str("An asset in a channel's Library (get_channel)."),
      characterId: str('A Character (get_channel); with blobId, one of its reference images.'),
      blobId: str("One of that Character's reference blobIds."),
      runId: str('A run; with stageKey for what a stage made, or alone for its final video.'),
      stageKey: str('A stage key of that run.'),
      itemIndex: { type: 'integer', minimum: 0, description: 'One item of an iterating stage.' },
    },
    [],
    description,
  );
}

export type MediaKind = 'image' | 'video' | 'audio' | 'other';

export interface MediaFile {
  blobId: string;
  kind: MediaKind;
  mime: string;
  /** How the tools name it to the model and the user, e.g. `the final video of run #a1b2c3d4`. */
  label: string;
  durationSec: number | null;
  width: number | null;
  height: number | null;
}

export type Resolved = { ok: true; file: MediaFile } | { ok: false; error: string };

const runHandle = (runId: string) => `#${runId.slice(-8).toLowerCase()}`;

function kindOf(mime: string): MediaKind {
  if (mime.startsWith('image/') && mime !== 'image/svg+xml') return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'other';
}

function kindOfArtifact(kind: string): MediaKind {
  if (kind === 'media.image') return 'image';
  if (kind === 'media.video') return 'video';
  if (kind === 'media.audio') return 'audio';
  return 'other';
}

type ProbeLike = {
  durationSec?: number;
  streams?: Array<{ type?: string; width?: number; height?: number }>;
} | null;

function facts(probe: unknown): Pick<MediaFile, 'durationSec' | 'width' | 'height'> {
  const p = (probe ?? null) as ProbeLike;
  const video = p?.streams?.find((s) => s.type === 'video' && s.width && s.height);
  return {
    durationSec: typeof p?.durationSec === 'number' ? Math.round(p.durationSec * 100) / 100 : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
  };
}

/** One stored file for a source. A run stage with several items needs `itemIndex` unless only one
 * of them is media of the wanted kinds. */
export async function resolveMedia(
  deps: Pick<ToolDeps, 'attachments' | 'assets' | 'characters' | 'runs' | 'runControl'>,
  source: MediaSource,
  wanted: MediaKind[] = ['image', 'video', 'audio'],
): Promise<Resolved> {
  const refuse = (file: MediaFile): Resolved =>
    wanted.includes(file.kind)
      ? { ok: true, file }
      : {
          ok: false,
          error: `${file.label} is ${file.kind === 'other' ? 'not a picture, video or sound' : `a ${file.kind}`}; this needs ${wanted.join(' or ')}.`,
        };

  if (source.attachmentId) {
    const file = await deps.attachments.file(source.attachmentId).catch(() => null);
    if (!file) return { ok: false, error: `There is no attachment "${source.attachmentId}".` };
    return refuse({
      blobId: file.blobId,
      kind: kindOf(file.mime),
      mime: file.mime,
      label: `the attached file "${file.name}"`,
      ...facts(file.probe),
    });
  }

  if (source.assetId) {
    const asset = await deps.assets.get(source.assetId).catch(() => null);
    if (!asset) return { ok: false, error: `There is no asset "${source.assetId}".` };
    return refuse({
      blobId: asset.blobId,
      kind: kindOfArtifact(asset.kind),
      mime: asset.file?.mime ?? '',
      label: `the asset "${asset.name}"`,
      durationSec: asset.file?.durationSec ?? null,
      width: asset.file?.width ?? null,
      height: asset.file?.height ?? null,
    });
  }

  if (source.characterId) {
    const character = await deps.characters.get(source.characterId).catch(() => null);
    if (!character) return { ok: false, error: `There is no Character "${source.characterId}".` };
    const refs = Array.isArray(character.referenceSet)
      ? (character.referenceSet as Array<{ blobId: string }>)
      : [];
    if (!refs.some((r) => r.blobId === source.blobId)) {
      return { ok: false, error: `That is not one of ${character.name}'s reference images.` };
    }
    return refuse({
      blobId: source.blobId!,
      kind: 'image',
      mime: 'image/png',
      label: `a reference image of ${character.name}`,
      durationSec: null,
      width: null,
      height: null,
    });
  }

  const runId = source.runId!;
  if (!source.stageKey) {
    const run = await deps.runControl.get(runId).catch(() => null);
    if (!run) return { ok: false, error: `There is no run "${runId}".` };
    const final = run.finalVideo;
    if (!final) return { ok: false, error: `Run ${runHandle(runId)} has no final video yet.` };
    return refuse({
      blobId: final.blobId,
      kind: 'video',
      mime: 'video/mp4',
      label: `the final video of run ${runHandle(runId)}`,
      ...facts((final as { probe?: unknown }).probe),
    });
  }
  const lookup = await deps.runs.media(runId, source.stageKey, source.itemIndex);
  if (!lookup) return { ok: false, error: `There is no run "${runId}".` };
  if (!lookup.found) {
    return {
      ok: false,
      error: `Run ${runHandle(runId)} has no stage "${source.stageKey}". Stages: ${lookup.stageKeys.join(', ')}.`,
    };
  }
  const targets = lookup.targets.filter((t) => t.blobId && wanted.includes(kindOfArtifact(t.kind)));
  if (targets.length === 0) {
    return {
      ok: false,
      error: `Stage "${source.stageKey}" of run ${runHandle(runId)} has no current ${wanted.join(' or ')} output${source.itemIndex === undefined ? ' (pass itemIndex for one item)' : ''}.`,
    };
  }
  if (targets.length > 1) {
    return {
      ok: false,
      error: `Stage "${source.stageKey}" has ${targets.length} items: pass itemIndex (${targets
        .map((t) => t.itemIndex)
        .join(', ')}).`,
    };
  }
  const target = targets[0]!;
  return {
    ok: true,
    file: {
      blobId: target.blobId!,
      kind: kindOfArtifact(target.kind),
      mime: '',
      label: `${source.stageKey}${target.itemIndex !== null ? ` item ${target.itemIndex}` : ''} of run ${runHandle(runId)}`,
      ...facts(target.probe),
    },
  };
}
