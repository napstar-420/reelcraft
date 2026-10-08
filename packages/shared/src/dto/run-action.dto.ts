import { z } from 'zod';
import { ConfigLayer } from '../config-layer';

/** What a stage retry re-runs besides the stage itself:
 * - `dependents`: later stages that read its output (provenance cascade)
 * - `stage`: nothing else; later stages keep their outputs
 * - `downstream`: every later stage in the graph */
export const RetryScope = z.enum(['dependents', 'stage', 'downstream']);
export type RetryScope = z.infer<typeof RetryScope>;

export const ConfirmRunActionDto = z.object({
  previewToken: z.string().min(1),
  itemIndex: z.number().int().nonnegative().optional(),
  scope: RetryScope.optional(),
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

/** Items of an iterating stage to redo, each with its own note, when the whole
 * stage is under review (`itemIndex` is for the stage that reviews item by item). */
export const RejectedItemsDto = z
  .array(
    z.object({
      itemIndex: z.number().int().nonnegative(),
      note: z.string().max(2000).optional(),
    }),
  )
  .min(1);
export type RejectedItemsDto = z.infer<typeof RejectedItemsDto>;

export const ApprovalActionDto = z
  .discriminatedUnion('action', [
    z.object({
      action: z.literal('approve'),
      itemIndex: z.number().int().nonnegative().optional(),
    }),
    // Quality control could not run and the output is parked for review: judge it again.
    z.object({
      action: z.literal('retry_qc'),
      itemIndex: z.number().int().nonnegative().optional(),
    }),
    z.object({
      action: z.literal('reject'),
      note: z.string().optional(),
      itemIndex: z.number().int().nonnegative().optional(),
      items: RejectedItemsDto.optional(),
      previewToken: z.string().min(1).optional(),
    }),
  ])
  .refine(
    (dto) => dto.action !== 'reject' || dto.items === undefined || dto.itemIndex === undefined,
    {
      path: ['items'],
      message: 'Send either items or itemIndex, not both',
    },
  );
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

/** A memory write the run's blueprint declares but that has no current
 * value yet — its writer hasn't run, or invalidation tombstoned it. */
export const ExpectedMemoryDto = z.object({
  memKey: z.string(),
  writtenBy: z.string(),
  path: z.string(),
  kind: z.string(),
});
export type ExpectedMemoryDto = z.infer<typeof ExpectedMemoryDto>;

export const RunMemoryDto = z.object({
  current: z.record(z.string(), RunMemoryEntryDto),
  history: z.array(RunMemoryEntryDto),
  expected: z.array(ExpectedMemoryDto),
});
export type RunMemoryDto = z.infer<typeof RunMemoryDto>;
