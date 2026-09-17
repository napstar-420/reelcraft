import { z } from 'zod';
import { RunState, StageExecutionState, AttemptOutcome } from '../primitives';
import { ConfigLayer } from '../config-layer';

export const CreateRunDto = z.object({
  channelId: z.string(),
  blueprintVersionId: z.string(),
  inputs: z.record(z.string(), z.unknown()).default({}),
  roleBindings: z.record(z.string(), z.string()).default({}),
  budgetCapUsd: z.number(),
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

export const StageAttemptDto = z.object({
  id: z.string(),
  attemptNo: z.number(),
  outcome: AttemptOutcome,
  renderedPrompt: z.string().nullable(),
  artifactId: z.string().nullable(),
  costUsd: z.number(),
  createdAt: z.string(),
});
export type StageAttemptDto = z.infer<typeof StageAttemptDto>;

export const StageExecutionDto = z.object({
  id: z.string(),
  stageKey: z.string(),
  state: StageExecutionState,
  isIterating: z.boolean(),
  itemCount: z.number().nullable(),
  attemptCount: z.number(),
  outputArtifactId: z.string().nullable(),
  costUsd: z.number(),
});
export type StageExecutionDto = z.infer<typeof StageExecutionDto>;

export const RunDetailDto = z.object({
  id: z.string(),
  channelId: z.string(),
  blueprintVersionId: z.string(),
  state: RunState,
  inputs: z.record(z.string(), z.unknown()),
  roleBindings: z.record(z.string(), z.string()),
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
