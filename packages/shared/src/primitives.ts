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

/** Narrower than StageExecutionState — stage_item never sees
 * awaiting_input/skipped (those are stage-level-only transitions). */
export const StageItemState = z.enum([
  'pending',
  'running',
  'awaiting_approval',
  'passed',
  'failed',
  'stale',
]);
export type StageItemState = z.infer<typeof StageItemState>;

/** §3.8.1 — the full set of terminal/branch outcomes for one stage attempt.
 * `awaiting_approval` is an in-flight sentinel (not terminal), set while a
 * stage-level approval gate is open. */
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
  'awaiting_approval',
]);
export type AttemptOutcome = z.infer<typeof AttemptOutcome>;

/** Mirrors AttemptOutcome's `awaiting_approval` sentinel — both flip
 * together when a stage-level approval gate opens. */
export const StageAttemptPhase = z.enum([
  'created',
  'reserved',
  'submitting',
  'submitted',
  'settled',
  'awaiting_approval',
]);
export type StageAttemptPhase = z.infer<typeof StageAttemptPhase>;

export const StageAttemptActor = z.enum(['engine', 'user']);
export type StageAttemptActor = z.infer<typeof StageAttemptActor>;

/** §3.10 — only `scope = 'run'` is collectable by retention GC. */
export const BlobScope = z.enum(['run', 'input', 'character', 'asset']);
export type BlobScope = z.infer<typeof BlobScope>;

/** §3.2 — which of channelId/blueprintId applies on a character row. */
export const CharacterScope = z.enum(['channel', 'blueprint']);
export type CharacterScope = z.infer<typeof CharacterScope>;

export const CharacterReadiness = z.enum(['draft', 'ready']);
export type CharacterReadiness = z.infer<typeof CharacterReadiness>;

export const LedgerEntryKind = z.enum(['reservation', 'actual', 'release']);
export type LedgerEntryKind = z.infer<typeof LedgerEntryKind>;

export const LedgerEntryCategory = z.enum(['stage_output', 'qc', 'check']);
export type LedgerEntryCategory = z.infer<typeof LedgerEntryCategory>;

/** §20 — 'builtin' marks engine-shipped presets seeded on migration. */
export const TemplateSource = z.enum(['builtin', 'user']);
export type TemplateSource = z.infer<typeof TemplateSource>;

export const TemplateKind = z.enum(['blueprint', 'schema', 'check', 'stage']);
export type TemplateKind = z.infer<typeof TemplateKind>;

export const HumanWaitKind = z.enum(['approval', 'input', 'timeline_edit']);
export type HumanWaitKind = z.infer<typeof HumanWaitKind>;

/** `failed` has no producer yet — reserved for a future terminal-error
 * path on async provider jobs. */
export const ProviderJobState = z.enum(['submitting', 'submitted', 'completed', 'failed']);
export type ProviderJobState = z.infer<typeof ProviderJobState>;
