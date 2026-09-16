import { z } from 'zod';

/** ULID string identity type (§3, design spec). */
export const Ulid = z.string();
export type Ulid = z.infer<typeof Ulid>;

export const Modality = z.enum(['text', 'image', 'video', 'audio', 'compute', 'human', 'publish']);
export type Modality = z.infer<typeof Modality>;

export const ArtifactKind = z.enum([
  'data',
  'text',
  'media.image',
  'media.video',
  'media.audio',
  'file.subtitles',
  'timeline',
]);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

/** OutputDef.kind draws from the same set as ArtifactKind (§4.2). */
export const OutputKind = ArtifactKind;
export type OutputKind = ArtifactKind;

export const RunState = z.enum([
  'CREATED',
  'RUNNING',
  'PAUSED_BUDGET',
  'PAUSED_APPROVAL',
  'PAUSED_INPUT',
  'FAILED',
  'COMPLETED',
  'CANCELLED',
]);
export type RunState = z.infer<typeof RunState>;

export const StageExecutionState = z.enum([
  'pending',
  'running',
  'awaiting_approval',
  'awaiting_input',
  'passed',
  'failed',
  'stale',
  'skipped',
]);
export type StageExecutionState = z.infer<typeof StageExecutionState>;

/** §3.8.1 — the full set of terminal/branch outcomes for one stage attempt. */
export const AttemptOutcome = z.enum([
  'success',
  'check_failed',
  'qc_failed',
  'qc_error',
  'qc_budget_exhausted',
  'provider_error',
  'provider_timeout',
  'infra_error',
  'budget_blocked',
  'rejected',
  'cancelled',
  'user_edit',
]);
export type AttemptOutcome = z.infer<typeof AttemptOutcome>;
