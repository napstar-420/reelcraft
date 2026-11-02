import type { AssistantAttachmentKind, Probe } from '@reelcraft/shared';

/** The largest file of each kind a chat takes. */
export const ATTACHMENT_LIMITS: Record<AssistantAttachmentKind, number> = {
  image: 20 * 1024 * 1024,
  video: 1024 * 1024 * 1024,
  audio: 1024 * 1024 * 1024,
  file: 50 * 1024 * 1024,
};

/** The longest video or audio the assistant reviews. */
export const MAX_ATTACHMENT_SECONDS = 15 * 60;

const EXT_KIND: Record<string, AssistantAttachmentKind> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  mkv: 'video',
  m4v: 'video',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  aac: 'audio',
  ogg: 'audio',
  flac: 'audio',
};

/** SVGs are drawings (text), not pictures to look at: they're `file`s here. */
export function attachmentKind(mime: string, ext: string): AssistantAttachmentKind {
  const type = mime.toLowerCase();
  if (type.startsWith('image/') && type !== 'image/svg+xml') return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  return EXT_KIND[ext.toLowerCase()] ?? 'file';
}

/** The mime to store when the browser sent none (or a generic one). */
export function attachmentMime(mime: string, ext: string): string {
  if (mime && mime !== 'application/octet-stream' && mime !== 'binary/octet-stream') return mime;
  const kind = EXT_KIND[ext.toLowerCase()];
  if (!kind || kind === 'file') return mime || 'application/octet-stream';
  const sub =
    ext.toLowerCase() === 'jpg'
      ? 'jpeg'
      : ext.toLowerCase() === 'mov'
        ? 'quicktime'
        : ext.toLowerCase() === 'mp3'
          ? 'mpeg'
          : ext.toLowerCase();
  return `${kind}/${sub}`;
}

export function extOf(key: string): string {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(key);
  return match ? match[1]!.toLowerCase() : '';
}

/** Width, height and length from ffprobe. A still image has no meaningful length. */
export function mediaFacts(
  probe: Probe | null | undefined,
  kind: AssistantAttachmentKind,
): { width: number | null; height: number | null; durationSec: number | null } {
  const video = probe?.streams.find((s) => s.type === 'video' && s.width && s.height);
  const duration =
    kind === 'video' || kind === 'audio'
      ? typeof probe?.durationSec === 'number' && Number.isFinite(probe.durationSec)
        ? Math.round(probe.durationSec * 100) / 100
        : null
      : null;
  return { width: video?.width ?? null, height: video?.height ?? null, durationSec: duration };
}

/** Why a file can't be attached, or null when it can. */
export function attachmentProblem(input: {
  kind: AssistantAttachmentKind;
  bytes: number;
  durationSec: number | null;
  probed: boolean;
}): string | null {
  const limit = ATTACHMENT_LIMITS[input.kind];
  if (input.bytes > limit) {
    return `That ${input.kind} is ${megabytes(input.bytes)}; the most a chat takes is ${megabytes(limit)}.`;
  }
  if (input.bytes === 0) return 'That file is empty.';
  if (input.kind !== 'file' && !input.probed) {
    return `That ${input.kind} couldn't be read. Is it a common format (PNG, JPEG, MP4, MOV, MP3, WAV)?`;
  }
  if (input.durationSec !== null && input.durationSec > MAX_ATTACHMENT_SECONDS) {
    return `That ${input.kind} is ${Math.round(input.durationSec / 60)} minutes long; the most the assistant reviews is ${MAX_ATTACHMENT_SECONDS / 60} minutes. Trim it first.`;
  }
  return null;
}

function megabytes(bytes: number): string {
  return bytes >= 1024 * 1024 * 1024
    ? `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
    : `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;
}

/** The line the model reads for each file a message carries. */
export function describeAttachment(a: {
  id: string;
  name: string;
  kind: AssistantAttachmentKind;
  mime: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  sourceUrl?: string | null;
}): string {
  const parts = [`${a.kind}`, a.mime];
  if (a.width && a.height) parts.push(`${a.width}x${a.height}`);
  if (a.durationSec !== null) parts.push(`${a.durationSec}s`);
  if (a.sourceUrl) parts.push(`from ${a.sourceUrl}`);
  return `- attachmentId ${a.id}: "${a.name}" (${parts.join(', ')})`;
}
