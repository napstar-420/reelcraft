import { z } from 'zod';
import { RunState, StageExecutionState, AttemptOutcome } from '../primitives';
import { ConfigLayer } from '../config-layer';

export const CreateRunDto = z.object({
  channelId: z.string(),
  blueprintVersionId: z.string(),
  inputs: z.record(z.string(), z.unknown()).default({}),
  roleBindings: z.record(z.string(), z.string()).default({}),
  budgetCapUsd: z.number().positive(),
});
export type CreateRunDto = z.infer<typeof CreateRunDto>;

/** §12.4 — raising a budget is the one mutation allowed while RUNNING, and
 * also unblocks a PAUSED_BUDGET run. No refinement beyond `number` here —
 * `LedgerService.raiseBudget` already throws loudly on a non-increasing cap
 * or a terminal run state; duplicating that rule in the DTO would just
 * create a second source of truth for it. */
export const RaiseBudgetDto = z.object({
  capUsd: z.number(),
});
export type RaiseBudgetDto = z.infer<typeof RaiseBudgetDto>;

/** Backs `POST /blueprints/:id/versions/:v/dry-run`. `budgetCapUsd` defaults
 * to a small fixed cap (the fake provider's per-call cost is near-zero, so
 * this only matters for a graph with many stages/iterations) but stays
 * caller-adjustable rather than hardcoded, so a larger dry run isn't at risk
 * of pausing on budget before it finishes. */
export const StartDryRunDto = z.object({
  budgetCapUsd: z.number().positive().default(1),
});
export type StartDryRunDto = z.infer<typeof StartDryRunDto>;

/** §6.2/§21 — requests a presigned PUT for a not-yet-uploaded media input
 * blob. Only `ext` is needed at this step; `mime`/`bytes`/`sha256` are only
 * known once the actual upload completes, so they travel with
 * `AttachInputDto` instead. */
export const RequestInputUploadDto = z.object({
  ext: z.string().min(1),
});
export type RequestInputUploadDto = z.infer<typeof RequestInputUploadDto>;

export const RequestInputUploadResultDto = z.object({
  blobId: z.string(),
  objectKey: z.string(),
  uploadUrl: z.string(),
});
export type RequestInputUploadResultDto = z.infer<typeof RequestInputUploadResultDto>;

/** §21 — attaches one or more already-uploaded blobs (from
 * `RequestInputUploadResultDto`) to a declared media input. Array length
 * must match the input's declared cardinality. */
export const AttachInputDto = z.object({
  blobs: z
    .array(
      z.object({
        blobId: z.string(),
        objectKey: z.string(),
        sha256: z.string(),
      }),
    )
    .min(1),
});
export type AttachInputDto = z.infer<typeof AttachInputDto>;

/** CREATED media attachment plus Phase 4 replacement payloads share the
 * same route. A replacement confirmation repeats the exact value/blob list
 * and adds the signed preview token. */
export const PutRunInputDto = z.union([
  AttachInputDto.extend({ previewToken: z.string().min(1).optional() }),
  z
    .object({ value: z.unknown(), previewToken: z.string().min(1).optional() })
    .refine((value) => Object.prototype.hasOwnProperty.call(value, 'value'), {
      path: ['value'],
      message: 'value is required',
    }),
]);
export type PutRunInputDto = z.infer<typeof PutRunInputDto>;

export const RunInputStatusDto = z.object({
  key: z.string(),
  count: z.number().int().nonnegative(),
  satisfied: z.boolean(),
});
export type RunInputStatusDto = z.infer<typeof RunInputStatusDto>;

export const StageAttemptDto = z.object({
  id: z.string(),
  attemptNo: z.number(),
  outcome: AttemptOutcome,
  phase: z.enum(['created', 'reserved', 'submitting', 'submitted', 'settled', 'awaiting_approval']),
  actor: z.enum(['engine', 'user']),
  renderedPrompt: z.string().nullable(),
  artifactId: z.string().nullable(),
  reviewNote: z.string().nullable(),
  critiqueTargetStageKey: z.string().nullable(),
  checkResults: z.unknown().nullable(),
  qcVerdict: z.unknown().nullable(),
  costUsd: z.number(),
  createdAt: z.string(),
});
export type StageAttemptDto = z.infer<typeof StageAttemptDto>;

export const ApprovalCandidateDto = z.object({
  stageKey: z.string(),
  itemIndex: z.number().int().nonnegative().nullable(),
  attempt: z.object({
    id: z.string(),
    attemptNo: z.number(),
    checkResults: z.unknown().nullable(),
    qcVerdict: z.unknown().nullable(),
    costUsd: z.number(),
    createdAt: z.string(),
  }),
  artifact: z.object({
    id: z.string(),
    kind: z.enum([
      'data',
      'text',
      'media.image',
      'media.video',
      'media.audio',
      'file.subtitles',
      'timeline',
    ]),
    data: z.unknown().nullable(),
    previewUrl: z.string().url().nullable(),
    attachments: z.array(
      z.object({
        id: z.string(),
        role: z.enum(['evidence', 'download']),
        filename: z.string(),
        mime: z.string(),
        url: z.string().url(),
      }),
    ),
  }),
});
export type ApprovalCandidateDto = z.infer<typeof ApprovalCandidateDto>;

export const StageExecutionDto = z.object({
  id: z.string(),
  stageKey: z.string(),
  state: StageExecutionState,
  isIterating: z.boolean(),
  itemCount: z.number().nullable(),
  attemptCount: z.number(),
  outputArtifactId: z.string().nullable(),
  costUsd: z.number(),
  capability: z.string(),
  interaction: z.enum(['form', 'timeline_editor']).nullable(),
  attachments: z.array(
    z.object({
      id: z.string(),
      blobId: z.string(),
      role: z.enum(['evidence', 'download']),
      filename: z.string(),
      mime: z.string(),
      url: z.string().url(),
    }),
  ),
});
export type StageExecutionDto = z.infer<typeof StageExecutionDto>;

export const RunDetailDto = z.object({
  id: z.string(),
  channelId: z.string(),
  blueprintVersionId: z.string(),
  state: RunState,
  inputs: z.record(z.string(), z.unknown()),
  // Created runs initially hold ids; start() replaces them with immutable
  // Character snapshots. Keep the detail DTO forward-compatible with both.
  roleBindings: z.record(z.string(), z.unknown()),
  resolvedConfig: z.record(z.string(), ConfigLayer),
  overrides: z.record(z.string(), ConfigLayer),
  cursorStageKey: z.string().nullable(),
  budgetCapUsd: z.number(),
  reservedUsd: z.number(),
  spentUsd: z.number(),
  stageExecutions: z.array(StageExecutionDto),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
});
export type RunDetailDto = z.infer<typeof RunDetailDto>;
