import { z } from 'zod';
import { ConfigLayer } from '../config-layer';

export const ConfirmRunActionDto = z.object({
  previewToken: z.string().min(1),
});
export type ConfirmRunActionDto = z.infer<typeof ConfirmRunActionDto>;

export const PatchRunOverridesDto = z.object({
  overrides: z.record(z.string(), ConfigLayer),
  previewToken: z.string().min(1).optional(),
});
export type PatchRunOverridesDto = z.infer<typeof PatchRunOverridesDto>;

export const ManualArtifactEditDto = z
  .object({
    value: z.unknown(),
    sourceArtifactId: z.string().optional(),
    previewToken: z.string().min(1).optional(),
  })
  .refine((value) => Object.prototype.hasOwnProperty.call(value, 'value'), {
    path: ['value'],
    message: 'value is required',
  });
export type ManualArtifactEditDto = z.infer<typeof ManualArtifactEditDto>;

export const ApprovalActionDto = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), itemIndex: z.number().int().nonnegative().optional() }),
  z.object({
    action: z.literal('reject'),
    note: z.string().optional(),
    itemIndex: z.number().int().nonnegative().optional(),
    previewToken: z.string().min(1).optional(),
  }),
]);
export type ApprovalActionDto = z.infer<typeof ApprovalActionDto>;

export const HumanInputSubmissionDto = z
  .object({ value: z.unknown() })
  .refine((value) => Object.prototype.hasOwnProperty.call(value, 'value'), {
    path: ['value'],
    message: 'value is required',
  });
export type HumanInputSubmissionDto = z.infer<typeof HumanInputSubmissionDto>;

export const InvalidationAffectedDto = z.object({
  stageKey: z.string(),
  stageExecutionId: z.string(),
  artifactId: z.string().optional(),
  itemIndex: z.number().int().nonnegative().optional(),
  spentUsd: z.number(),
  estimatedRerunUsd: z.number(),
});
export type InvalidationAffectedDto = z.infer<typeof InvalidationAffectedDto>;

export const InvalidationPreviewDto = z.object({
  previewToken: z.string(),
  expiresAt: z.string(),
  affected: z.array(InvalidationAffectedDto),
  spentUsd: z.number(),
  estimatedRerunUsd: z.number(),
});
export type InvalidationPreviewDto = z.infer<typeof InvalidationPreviewDto>;

export const RunMemoryEntryDto = z.object({
  id: z.string(),
  memKey: z.string(),
  version: z.number().int().positive(),
  writtenBy: z.string(),
  writtenItem: z.number().int().nonnegative().nullable(),
  kind: z.string(),
  data: z.unknown().nullable(),
  artifactId: z.string().nullable(),
  tombstone: z.boolean(),
  createdAt: z.string(),
});
export type RunMemoryEntryDto = z.infer<typeof RunMemoryEntryDto>;

export const RunMemoryDto = z.object({
  current: z.record(z.string(), RunMemoryEntryDto),
  history: z.array(RunMemoryEntryDto),
});
export type RunMemoryDto = z.infer<typeof RunMemoryDto>;
