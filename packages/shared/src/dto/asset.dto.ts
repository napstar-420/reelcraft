import { z } from 'zod';

/** §3.3 — the asset-kind vocabulary is broader than `ArtifactKind`: it also
 * covers `font`/`lut`, consumed by timeline rendering (phase 6) rather than
 * the `Ref` binding pipeline. */
export const AssetKind = z.enum(['media.image', 'media.video', 'media.audio', 'font', 'lut']);
export type AssetKind = z.infer<typeof AssetKind>;

export const RequestAssetUploadDto = z.object({
  ext: z.string().min(1),
});
export type RequestAssetUploadDto = z.infer<typeof RequestAssetUploadDto>;

export const RequestAssetUploadResultDto = z.object({
  blobId: z.string(),
  objectKey: z.string(),
  uploadUrl: z.string(),
});
export type RequestAssetUploadResultDto = z.infer<typeof RequestAssetUploadResultDto>;

export const CreateAssetDto = z.object({
  name: z.string().min(1),
  kind: AssetKind,
  blobId: z.string(),
  objectKey: z.string(),
  sha256: z.string(),
  tags: z.array(z.string()).default([]),
});
export type CreateAssetDto = z.infer<typeof CreateAssetDto>;

export const AssetDto = z.object({
  id: z.string(),
  ownerId: z.string(),
  channelId: z.string(),
  name: z.string(),
  kind: AssetKind,
  blobId: z.string(),
  tags: z.array(z.string()),
  createdAt: z.string(),
});
export type AssetDto = z.infer<typeof AssetDto>;
