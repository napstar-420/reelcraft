/** Files the user attaches to an assistant message: what the composer accepts and how it shows
 * them. The server checks again (its limits are the authority). */

export type AttachmentKind = 'image' | 'video' | 'audio' | 'file';

export const MAX_FILES = 10;

/** The same limits as the server, so a too-big file is refused before it uploads. */
export const LIMITS: Record<AttachmentKind, number> = {
  image: 20 * 1024 * 1024,
  video: 1024 * 1024 * 1024,
  audio: 1024 * 1024 * 1024,
  file: 50 * 1024 * 1024,
};

/** Files larger than this are not hashed in the browser (it would read all of it into memory). */
export const HASH_LIMIT = 100 * 1024 * 1024;

export const ACCEPT =
  'image/*,video/*,audio/*,.mp4,.mov,.webm,.mkv,.mp3,.wav,.m4a,.svg,.pdf,.txt,.md,.json,.srt,.vtt';

const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'mkv', 'm4v']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function fileKind(file: { name: string; type: string }): AttachmentKind {
  const ext = extensionOf(file.name);
  if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') return 'image';
  if (file.type.startsWith('video/') || VIDEO_EXT.has(ext)) return 'video';
  if (file.type.startsWith('audio/') || AUDIO_EXT.has(ext)) return 'audio';
  if (IMAGE_EXT.has(ext)) return 'image';
  return 'file';
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatDuration(seconds: number | null): string | null {
  if (seconds === null) return null;
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Why a file can't be attached, before uploading it; null when it can. */
export function refusal(file: { name: string; type: string; size: number }): string | null {
  const kind = fileKind(file);
  if (!extensionOf(file.name)) return `"${file.name}" has no file extension.`;
  if (file.size === 0) return `"${file.name}" is empty.`;
  if (file.size > LIMITS[kind]) {
    return `"${file.name}" is ${formatBytes(file.size)}; the most a chat takes is ${formatBytes(LIMITS[kind])}.`;
  }
  return null;
}

/** The files from a paste or a drop (a paste of text has none). */
export function filesFrom(list: FileList | null | undefined): File[] {
  return list ? Array.from(list) : [];
}
