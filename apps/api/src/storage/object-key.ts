/** §4.3 — typed key builders. No ad-hoc string concatenation of object keys
 * anywhere else in the codebase. */
export const objectKey = {
  rawResponse: (ownerId: string, channelId: string, runId: string, attemptId: string): string =>
    `${ownerId}/${channelId}/${runId}/raw/${attemptId}.json`,

  media: (
    ownerId: string,
    channelId: string,
    runId: string,
    artifactId: string,
    ext: string,
  ): string => `${ownerId}/${channelId}/${runId}/media/${artifactId}.${ext}`,

  attachment: (
    ownerId: string,
    channelId: string,
    runId: string,
    blobId: string,
    filename: string,
  ): string => `${ownerId}/${channelId}/${runId}/attachments/${blobId}-${filename}`,

  input: (ownerId: string, channelId: string, runId: string, blobId: string, ext: string): string =>
    `${ownerId}/${channelId}/${runId}/inputs/${blobId}.${ext}`,

  asset: (ownerId: string, channelId: string, blobId: string, ext: string): string =>
    `${ownerId}/${channelId}/assets/${blobId}.${ext}`,

  characterRef: (ownerId: string, characterId: string, blobId: string): string =>
    `${ownerId}/characters/${characterId}/refs/${blobId}.png`,

  /** §14.4 — ffmpeg-extracted `firstFrame`/`lastFrame` PNGs, cached on the
   * source artifact's `derived` column and stored as their own `blob` row
   * (`scope: 'run'`) so they're collected by the normal run-scoped GC sweep. */
  derivedFrame: (ownerId: string, channelId: string, runId: string, blobId: string): string =>
    `${ownerId}/${channelId}/${runId}/derived/${blobId}.png`,
};
