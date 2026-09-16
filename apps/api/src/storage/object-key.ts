/** §4.3 — typed key builders. No ad-hoc string concatenation of object keys
 * anywhere else in the codebase. */
export const objectKey = {
  rawResponse: (ownerId: string, channelId: string, runId: string, attemptId: string): string =>
    `${ownerId}/${channelId}/${runId}/raw/${attemptId}.json`,

  media: (ownerId: string, channelId: string, runId: string, artifactId: string, ext: string): string =>
    `${ownerId}/${channelId}/${runId}/media/${artifactId}.${ext}`,

  input: (ownerId: string, channelId: string, runId: string, blobId: string, ext: string): string =>
    `${ownerId}/${channelId}/${runId}/inputs/${blobId}.${ext}`,

  asset: (ownerId: string, channelId: string, blobId: string, ext: string): string =>
    `${ownerId}/${channelId}/assets/${blobId}.${ext}`,

  characterRef: (ownerId: string, characterId: string, blobId: string): string =>
    `${ownerId}/characters/${characterId}/refs/${blobId}.png`,
};
