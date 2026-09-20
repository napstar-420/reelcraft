import { z } from 'zod';
import { ReferenceImage } from '../character';

export const CreateCharacterDto = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
});
export type CreateCharacterDto = z.infer<typeof CreateCharacterDto>;

export const UpdateCharacterDto = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
});
export type UpdateCharacterDto = z.infer<typeof UpdateCharacterDto>;

export const RequestCharacterReferenceUploadDto = z.object({ ext: z.string().min(1) });
export type RequestCharacterReferenceUploadDto = z.infer<typeof RequestCharacterReferenceUploadDto>;

export const ConfirmCharacterReferenceDto = z.object({
  blobId: z.string(),
  objectKey: z.string(),
  sha256: z.string(),
  view: ReferenceImage.shape.view,
  caption: z.string().optional(),
  order: z.number().int().nonnegative().optional(),
});
export type ConfirmCharacterReferenceDto = z.infer<typeof ConfirmCharacterReferenceDto>;

export const UpdateCharacterReferenceDto = z.object({
  view: ReferenceImage.shape.view.optional(),
  caption: z.string().optional(),
  order: z.number().int().nonnegative().optional(),
});
export type UpdateCharacterReferenceDto = z.infer<typeof UpdateCharacterReferenceDto>;

export const PromoteCharacterReferenceDto = z.object({
  artifactId: z.string(),
  view: ReferenceImage.shape.view,
  caption: z.string().optional(),
});
export type PromoteCharacterReferenceDto = z.infer<typeof PromoteCharacterReferenceDto>;

export const SetPrimaryCharacterReferenceDto = z.object({ blobId: z.string() });
export type SetPrimaryCharacterReferenceDto = z.infer<typeof SetPrimaryCharacterReferenceDto>;
