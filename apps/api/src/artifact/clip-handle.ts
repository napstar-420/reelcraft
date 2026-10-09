/** A `media.video_list` artifact keeps its clips in `data.clips`, and a
 * `media.image_list` artifact its images in `data.images`, one blob each. An
 * item is addressed as `artifact:<artifactId>#<position>`, the position being
 * its place in that list. */

export interface StoredClip {
  index: number;
  label: string | null;
  prompt: string | null;
  filename: string;
  blobId: string;
  probe: unknown;
}

export function clipHandle(artifactId: string, position: number): string {
  return `artifact:${artifactId}#${position}`;
}

/** `artifact:<id>` or `artifact:<id>#<position>`; undefined for any other handle. */
export function parseArtifactHandle(
  handle: string,
): { artifactId: string; clipPosition?: number } | undefined {
  const match = /^artifact:([^#]+)(?:#(\d+))?$/.exec(handle);
  if (!match) return undefined;
  return {
    artifactId: match[1]!,
    ...(match[2] !== undefined && { clipPosition: Number(match[2]) }),
  };
}

/** The artifact kinds that hold an ordered list of media files. */
export const LIST_KINDS = ['media.video_list', 'media.image_list'] as const;
export type ListKind = (typeof LIST_KINDS)[number];

export function isListKind(kind: string): kind is ListKind {
  return (LIST_KINDS as readonly string[]).includes(kind);
}

/** The kind of one item of a list: what it binds as. */
export function listItemKind(kind: ListKind): 'media.video' | 'media.image' {
  return kind === 'media.image_list' ? 'media.image' : 'media.video';
}

/** The clips of a stored `media.video_list` artifact, in order. */
export function storedClips(data: unknown): StoredClip[] {
  const clips = (data as { clips?: unknown } | null)?.clips;
  return Array.isArray(clips) ? (clips as StoredClip[]) : [];
}

/** The images of a stored `media.image_list` artifact, in order. */
export function storedImages(data: unknown): StoredClip[] {
  const images = (data as { images?: unknown } | null)?.images;
  return Array.isArray(images) ? (images as StoredClip[]) : [];
}

/** A picked `media.image` artifact keeps the candidates it was chosen from in `data.candidates`. */
export function storedCandidates(data: unknown): StoredClip[] {
  const candidates = (data as { candidates?: unknown } | null)?.candidates;
  return Array.isArray(candidates) ? (candidates as StoredClip[]) : [];
}

/** The items of a stored list artifact of either kind, in order. */
export function storedListItems(kind: ListKind, data: unknown): StoredClip[] {
  return kind === 'media.image_list' ? storedImages(data) : storedClips(data);
}
