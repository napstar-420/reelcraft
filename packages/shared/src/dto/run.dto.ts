import { z } from 'zod';
import { RunState, StageExecutionState, AttemptOutcome, HumanWaitKind } from '../primitives';
import { ConfigLayer } from '../config-layer';
import { Probe } from '../probe';
import { OutputDef } from '../output';
import { CreateBlueprintVersionDto } from './blueprint.dto';

/** A media URL the browser loads: absolute, or relative to the app's own
 * origin when a self-hosted install proxies storage (`/storage/...`). */
export const BrowserMediaUrl = z.union([z.string().url(), z.string().regex(/^\/(?!\/)/)]);

/** Why a seeded run could not reuse a stage (and so re-runs it and everything
 * after it); see `reusableStageKeys` on the API side. */
export const SeedStopReason = z.enum([
  'roles_changed',
  'definition_changed',
  'config_changed',
  'assets_changed',
  'not_in_source',
  'awaiting_approval',
  'awaiting_input',
  'failed',
  'cancelled',
  'not_run',
  'items_incomplete',
  'rerun_requested',
]);
export type SeedStopReason = z.infer<typeof SeedStopReason>;

/** The first stage a seeded run re-runs instead of reusing, and why. */
export const SeedStop = z.object({ stageKey: z.string(), reason: SeedStopReason });
export type SeedStop = z.infer<typeof SeedStop>;

/** What a seeded run would reuse: the stages copied from the source run, then
 * the stage where reuse stopped. */
export const SeedPlanDto = z.object({
  reused: z.array(z.string()),
  stop: SeedStop,
  discardedStageKeys: z.array(z.string()).optional(),
});
export type SeedPlanDto = z.infer<typeof SeedPlanDto>;

/** Body of the 409 `RunService.create` answers with when `expectReusedBefore`
 * is set and a stage before it would be re-run. */
export const UpstreamRerunDto = z.object({
  code: z.literal('upstream_rerun'),
  message: z.string(),
  plan: SeedPlanDto,
});
export type UpstreamRerunDto = z.infer<typeof UpstreamRerunDto>;

export const ExecutionScope = z.object({
  kind: z.enum(['blueprint', 'selection']),
  stageKeys: z.array(z.string()),
});
export type ExecutionScope = z.infer<typeof ExecutionScope>;
export const ExecutionSettingsDto = z.object({
  concurrentBranches: z.number().int().positive().safe(),
});
export type ExecutionSettingsDto = z.infer<typeof ExecutionSettingsDto>;
export const StageAvailableActions = z.object({
  run: z.boolean(),
  continue: z.boolean(),
  rerun: z.boolean(),
  runThrough: z.boolean().optional(),
  rebuildDescendants: z.boolean().optional(),
  blockedReason: z.string().nullable(),
  completedItems: z.number(),
  totalItems: z.number().nullable(),
});
export type StageAvailableActions = z.infer<typeof StageAvailableActions>;
export const RunAvailableActions = z.object({
  pause: z.boolean(),
  resume: z.boolean(),
  cancel: z.boolean(),
  changeConcurrency: z.boolean(),
  busy: z.boolean(),
});
export type RunAvailableActions = z.infer<typeof RunAvailableActions>;

export const CreateRunDto = z.object({
  channelId: z.string(),
  blueprintVersionId: z.string(),
  concurrentBranches: z.number().int().positive().safe().optional(),
  inputs: z.record(z.string(), z.unknown()).default({}),
  roleBindings: z.record(z.string(), z.string()).default({}),
  /** Zero means no limit. */
  budgetCapUsd: z.number().nonnegative(),
  // Canvas "run a stage without re-running upstream" — an existing run whose
  // still-valid prefix of stages should be copied into this new run instead
  // of re-executed. See RunService.create's seed-run path.
  seedFromRunId: z.string().optional(),
  // Forces these stage keys (and everything at/after the earliest one, per
  // `reusableStageKeys`) to re-run even if they'd otherwise be reusable —
  // e.g. the user edited stage 3's prompt.
  rerunStageKeys: z.array(z.string()).default([]),
  // With `seedFromRunId`: finished stages whose results are kept even though their
  // definition (or settings) changed since the source run. The person chose to continue
  // after them instead of regenerating them.
  keepStageKeys: z.array(z.string()).optional(),
  // Initial scope through this stage; unrelated stages remain pending and the run ends Idle.
  untilStageKey: z.string().optional(),
  // With `seedFromRunId`: refuse (409 `upstream_rerun`, nothing created) if any
  // stage before this one would be re-run rather than reused, so "run this
  // stage" can ask first instead of silently running an earlier stage.
  expectReusedBefore: z.string().optional(),
  /** A dry run: every model is forced to the free fake provider (see
   * `RunService.applyDryRunOverride`). Media inputs upload as for a real run. */
  dryRun: z.boolean().optional(),
});
export type CreateRunDto = z.infer<typeof CreateRunDto>;

export const ContinueRunDto = z.object({
  blueprintVersionId: z.string().min(1),
  untilStageKey: z.string().min(1).optional(),
});
export type ContinueRunDto = z.infer<typeof ContinueRunDto>;

export const StageRunPlanRequestDto = z.object({
  blueprintVersionId: z.string().min(1),
  stageKey: z.string().min(1).optional(),
  mode: z.enum(['reuse', 'rebuild', 'validate']),
  action: z.enum(['run', 'continue', 'rerun']).optional(),
  itemIndex: z.number().int().nonnegative().optional(),
  allowUncertainRestart: z.boolean().optional(),
  /** Continue only: redo outputs an earlier change made out of date (the default), or keep them. */
  outdatedOutputs: z.enum(['regenerate', 'keep']).optional(),
  scope: z.enum(['stage', 'through', 'descendants']).default('stage'),
});
export type StageRunPlanRequestDto = z.infer<typeof StageRunPlanRequestDto>;
export const ConfirmStageRunPlanDto = StageRunPlanRequestDto.extend({
  previewToken: z.string().min(1),
});
export type ConfirmStageRunPlanDto = z.infer<typeof ConfirmStageRunPlanDto>;
export const StageRunPlanDto = z.object({
  request: StageRunPlanRequestDto,
  previewToken: z.string(),
  runStageKeys: z.array(z.string()),
  /** Of `runStageKeys`, the stages that are disabled: they are marked skipped, not run. */
  skippedStageKeys: z.array(z.string()).optional(),
  reusedStageKeys: z.array(z.string()),
  staleStageKeys: z.array(z.string()),
  invalidatedStageKeys: z.array(z.string()),
  validationStageKeys: z.array(z.string()),
  estimatedRerunUsd: z.number(),
  blockedReason: z.string().nullable(),
  uncertainAttemptIds: z.array(z.string()).optional(),
  retainedItemCount: z.number().optional(),
  /** Outputs an earlier change made out of date, whichever way Continue treats them: items of a
   * done stage (`itemIndexes`) or a whole stage (empty). */
  outdated: z
    .array(z.object({ stageKey: z.string(), itemIndexes: z.array(z.number()) }))
    .optional(),
  availabilityChangedStageKeys: z.array(z.string()).optional(),
});
export type StageRunPlanDto = z.infer<typeof StageRunPlanDto>;

/** §12.4 — raising a budget is the one mutation allowed while RUNNING, and
 * also unblocks a PAUSED_BUDGET run. No refinement beyond `number` here —
 * `LedgerService.raiseBudget` already throws loudly on a non-increasing cap
 * or a terminal run state; duplicating that rule in the DTO would just
 * create a second source of truth for it. */
export const RaiseBudgetDto = z.object({
  capUsd: z.number().positive(),
  /** Raise this stage's own cap (for this run) instead of the run cap. */
  stageKey: z.string().min(1).optional(),
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
  /** The iteration item this attempt belongs to (0-based); null for a stage that doesn't iterate. */
  itemIndex: z.number().nullable(),
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

export const ArtifactViewDto = z.object({
  id: z.string(),
  kind: z.enum([
    'data',
    'text',
    'media.image',
    'media.video',
    'media.audio',
    'media.video_list',
    'media.image_list',
    'file.subtitles',
    'timeline',
  ]),
  data: z.unknown().nullable(),
  previewUrl: BrowserMediaUrl.nullable(),
  /** Media metadata (duration, resolution, fps, audio) for `media.*` kinds. */
  probe: Probe.nullable(),
  attachments: z.array(
    z.object({
      id: z.string(),
      role: z.enum(['evidence', 'download']),
      filename: z.string(),
      mime: z.string(),
      url: BrowserMediaUrl,
    }),
  ),
  /** The clips of a `media.video_list` artifact, in order. */
  clips: z
    .array(
      z.object({
        index: z.number().int(),
        label: z.string().nullable(),
        url: BrowserMediaUrl,
        probe: Probe.nullable(),
      }),
    )
    .optional(),
  /** The images of a `media.image_list` artifact, in order. */
  images: z
    .array(
      z.object({
        index: z.number().int(),
        label: z.string().nullable(),
        url: BrowserMediaUrl,
        probe: Probe.nullable(),
      }),
    )
    .optional(),
  /** The candidates a `media.image` artifact was picked from (Generate Image with
   * several candidates), in order; `selected` marks the one the artifact is. */
  candidates: z
    .array(
      z.object({
        index: z.number().int(),
        label: z.string().nullable(),
        url: BrowserMediaUrl,
        probe: Probe.nullable(),
        selected: z.boolean(),
      }),
    )
    .optional(),
});
export type ArtifactViewDto = z.infer<typeof ArtifactViewDto>;

export const ApprovalCandidateDto = z.object({
  stageKey: z.string(),
  itemIndex: z.number().int().nonnegative().nullable(),
  /** Every item of the stage waiting for approval, in order. More than one when the
   * stage runs its items concurrently; the review moves on to the next after each. */
  pendingItemIndexes: z.array(z.number().int().nonnegative()).default([]),
  attempt: z.object({
    id: z.string(),
    attemptNo: z.number(),
    checkResults: z.unknown().nullable(),
    qcVerdict: z.unknown().nullable(),
    /** Why quality control could not judge this output, when that is why it
     * is waiting for review; the review then offers "Retry QC". */
    qcUnavailable: z.string().nullable(),
    costUsd: z.number(),
    createdAt: z.string(),
  }),
  /** The output under review; null when a whole-stage review has none left. */
  artifact: ArtifactViewDto.nullable(),
  /** A stage that runs items but is reviewed as a whole: every item's output. */
  items: z
    .array(z.object({ itemIndex: z.number().int().nonnegative(), artifact: ArtifactViewDto }))
    .default([]),
});
export type ApprovalCandidateDto = z.infer<typeof ApprovalCandidateDto>;

export const StageEventLevel = z.enum(['debug', 'info', 'warn', 'error']);
export type StageEventLevel = z.infer<typeof StageEventLevel>;

export const StageEventDto = z.object({
  id: z.string(),
  stageAttemptId: z.string().nullable(),
  itemIndex: z.number().int().nonnegative().nullable(),
  level: StageEventLevel,
  type: z.string(),
  message: z.string(),
  data: z.unknown().nullable(),
  createdAt: z.string(),
});
export type StageEventDto = z.infer<typeof StageEventDto>;

export const StageOutputDto = z.object({
  stageKey: z.string(),
  items: z.array(
    z.object({
      itemIndex: z.number().int().nonnegative().nullable(),
      artifact: ArtifactViewDto,
    }),
  ),
  /** Items (or the whole stage, `itemIndex: null`) whose output is out of date because an earlier
   * stage changed, with the last output they had when it is still stored. */
  staleItems: z.array(
    z.object({
      itemIndex: z.number().int().nonnegative().nullable(),
      artifact: ArtifactViewDto.nullable(),
    }),
  ),
});
export type StageOutputDto = z.infer<typeof StageOutputDto>;

export const StageAttemptDetailDto = StageAttemptDto.extend({
  resolvedInputs: z.unknown().nullable(),
  durationMs: z.number().nullable(),
  artifact: ArtifactViewDto.nullable(),
});
export type StageAttemptDetailDto = z.infer<typeof StageAttemptDetailDto>;

export const StageExecutionDto = z.object({
  id: z.string(),
  stageKey: z.string(),
  /** The stage's Label from the run's blueprint version (its key if unset). */
  label: z.string(),
  /** The stage's declared output (kind, and schema for `data`), so a human
   * input form can be built for it. */
  output: OutputDef.nullable(),
  state: StageExecutionState,
  skipReason: z.string().nullable().optional(),
  disabled: z.boolean().optional(),
  outputAvailable: z.boolean().optional(),
  failure: z.unknown().optional(),
  availableActions: StageAvailableActions.optional(),
  isIterating: z.boolean(),
  itemCount: z.number().nullable(),
  /** Items of an iterating stage whose output is out of date. */
  staleItemCount: z.number().optional(),
  /** The stage had an accepted output that an earlier change made out of date. */
  outputStale: z.boolean().optional(),
  /** A change upstream reset the stage, and its last attempt had failed: it still counts as failed. */
  lastRunFailed: z.boolean().optional(),
  attemptCount: z.number(),
  outputArtifactId: z.string().nullable(),
  costUsd: z.number(),
  capability: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  interaction: z.enum(['form', 'timeline_editor']).nullable(),
  /** What a person is being asked for right now: set while the stage — or, for
   * item-mode approval, one of its items — has an open wait nobody has answered. */
  waiting: HumanWaitKind.nullable(),
  attachments: z.array(
    z.object({
      id: z.string(),
      blobId: z.string(),
      role: z.enum(['evidence', 'download']),
      filename: z.string(),
      mime: z.string(),
      url: BrowserMediaUrl,
    }),
  ),
});
export type StageExecutionDto = z.infer<typeof StageExecutionDto>;

export const RunDetailDto = z.object({
  revision: z.number().int().nonnegative().optional(),
  id: z.string(),
  channelId: z.string(),
  blueprintVersionId: z.string(),
  blueprintId: z.string().optional(),
  definition: CreateBlueprintVersionDto.optional(),
  /** A test run: it runs a canvas draft snapshot, not a saved version. */
  draft: z.boolean().optional(),
  executionEpoch: z.number().optional(),
  executionScope: ExecutionScope.nullable().optional(),
  concurrentBranches: z.number().optional(),
  availableActions: RunAvailableActions.optional(),
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
  /** Set while `PAUSED_BUDGET`: which cap paused the run. `stage` means the
   * stage's own Stage cap (raise it with `RaiseBudgetDto.stageKey`). */
  /** Set while `PAUSED_QUOTA`: when the run resumes by itself (ISO time). */
  resumeAt: z.string().nullable().optional(),
  budgetBlock: z
    .object({
      scope: z.enum(['run', 'stage']),
      stageKey: z.string(),
      stageCapUsd: z.number().nullable(),
    })
    .nullable(),
  finalVideo: z
    .object({
      artifactId: z.string(),
      blobId: z.string(),
      durationSec: z.number().optional(),
      posterBlobId: z.string().optional(),
    })
    .nullable(),
});
export type RunDetailDto = z.infer<typeof RunDetailDto>;

/** Lightweight row for the runs list page (Runs tab) — deliberately excludes
 * `stageExecutions`/`resolvedConfig`/`overrides`/`roleBindings`/`inputs` since
 * a list row never needs them, and includes channel/blueprint display names
 * (joined server-side) so the list page never needs N+1 lookups per row. */
export const RunSummaryDto = z.object({
  id: z.string(),
  channelId: z.string(),
  channelName: z.string(),
  blueprintId: z.string(),
  blueprintName: z.string(),
  blueprintVersionId: z.string(),
  /** `major.minor`, e.g. "1.5". */
  blueprintVersion: z.string(),
  state: RunState,
  dryRun: z.boolean(),
  /** Run of a canvas draft snapshot (unsaved edits), not a saved version. */
  draft: z.boolean(),
  budgetCapUsd: z.number(),
  spentUsd: z.number(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  posterBlobId: z.string().nullable(),
});
export type RunSummaryDto = z.infer<typeof RunSummaryDto>;

export const ListRunsResultDto = z.object({
  items: z.array(RunSummaryDto),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type ListRunsResultDto = z.infer<typeof ListRunsResultDto>;

/** Query params arrive as strings over HTTP; `z.coerce` turns `"20"`/`"true"`
 * into number/boolean before `ZodValidationPipe` hands the controller a typed
 * object. `state` is single-value (not a multi-select) to avoid inventing
 * repeated-query-param array parsing for a first cut of run filtering. */
export const ListRunsQueryDto = z.object({
  channelId: z.string().optional(),
  blueprintId: z.string().optional(),
  state: RunState.optional(),
  includeDryRuns: z.coerce.boolean().optional().default(false),
  includeDrafts: z.coerce.boolean().optional().default(false),
  /** Only test runs (draft snapshots): the canvas's run list. Implies includeDrafts. */
  draftsOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
});
export type ListRunsQueryDto = z.infer<typeof ListRunsQueryDto>;
