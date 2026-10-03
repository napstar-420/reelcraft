import { z } from 'zod';
import { Ref } from './ref';
import { OutputDef } from './output';
import { CheckDef } from './check';
import { QcDef } from './qc';
import { PartialModelPin } from './config-layer';

export const EnabledWhen = z.object({
  input: z.string(),
  equals: z.union([z.string(), z.number(), z.boolean()]),
});
export type EnabledWhen = z.infer<typeof EnabledWhen>;

/**
 * §3.5 — a user-defined unit of work. `iterate` (renamed from v4's `fanOut`)
 * loops in order, item i may consume item i-1; nothing runs in parallel.
 */
export const StageDef = z.object({
  key: z.string(),
  label: z.string(),
  capability: z.string(),
  instructions: z.object({ system: z.string().optional(), template: z.string() }).optional(),
  config: z.record(z.string(), z.unknown()),
  slots: z.record(z.string(), Ref),
  context: z.record(z.string(), Ref),
  /** Context keys whose files are attached to the model request (text
   * generation). Binding a file in `context` alone only passes its JSON
   * record (handle, kind, …), e.g. for a timeline stage that needs handles. */
  attach: z.array(z.string()).optional(),
  writes: z.record(z.string(), z.string()).optional(),
  output: OutputDef,
  iterate: z
    .object({
      over: Ref,
      /** Reserved for a future phase — not implemented; the engine and validator never read it (§14). */
      groupKey: z.string().optional(),
      itemAlias: z.string(),
      alignWith: z.literal('item').optional(),
      itemRetryLimit: z.number(),
      maxItems: z.number().optional(),
    })
    .optional(),
  checks: z.array(CheckDef),
  /** Failed check rounds allowed before the stage fails; each failure
   * regenerates with the failing checks' messages as feedback. */
  checkMaxAttempts: z.number().int().min(1).optional(),
  qc: QcDef.optional(),
  /** Retries for crashes only (provider error, timeout, thrown bug) — never
   * consumed by check/QC failures or human rejections. */
  /** Automatic retries after a crash. Unset inherits the blueprint, channel
   * or engine default (0). */
  retryLimit: z.number().int().min(0).optional(),
  approval: z
    .object({
      mode: z.enum(['stage', 'item']),
      onReject: z.object({ retryStageKey: z.string() }).optional(),
    })
    .optional(),
  budget: z
    .object({ stageCapUsd: z.number().optional(), qcCapUsd: z.number().optional() })
    .optional(),
  model: PartialModelPin.optional(),
  enabledWhen: EnabledWhen.optional(),
});
export type StageDef = z.infer<typeof StageDef>;

/** Approval granularity for a stage's review gate — its own `approval.mode`,
 * or (for a gate opened by `qc.onExhausted: 'human_review'` on a stage with
 * no `approval`) per item when it iterates, per stage otherwise. */
export function approvalModeOf(stage: StageDef): 'stage' | 'item' {
  return stage.approval?.mode ?? (stage.iterate ? 'item' : 'stage');
}
