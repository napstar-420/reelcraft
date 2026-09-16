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
  instructions: z
    .object({ system: z.string().optional(), template: z.string() })
    .optional(),
  config: z.record(z.string(), z.unknown()),
  slots: z.record(z.string(), Ref),
  context: z.record(z.string(), Ref),
  writes: z.record(z.string(), z.string()).optional(),
  output: OutputDef,
  iterate: z
    .object({
      over: Ref,
      groupKey: z.string().optional(),
      itemAlias: z.string(),
      alignWith: z.literal('item').optional(),
      itemRetryLimit: z.number(),
    })
    .optional(),
  checks: z.array(CheckDef),
  qc: QcDef.optional(),
  retryLimit: z.number(),
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
