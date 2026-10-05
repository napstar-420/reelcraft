/** A `media.video_list` artifact keeps its clips in `data.clips`, one blob each.
 * A clip is addressed as `artifact:<artifactId>#<position>`, the position
 * being its place in that list. */

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

/** The clips of a stored `media.video_list` artifact, in order. */
export function storedClips(data: unknown): StoredClip[] {
  const clips = (data as { clips?: unknown } | null)?.clips;
  return Array.isArray(clips) ? (clips as StoredClip[]) : [];
}
