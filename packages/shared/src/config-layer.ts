import { z } from 'zod';
import { Modality } from './primitives';

export const ModelPin = z.object({
  provider: z.string(),
  modelId: z.string(),
  version: z.string().optional(),
  params: z.record(z.string(), z.unknown()),
});
export type ModelPin = z.infer<typeof ModelPin>;

export const PartialModelPin = ModelPin.partial();
export type PartialModelPin = z.infer<typeof PartialModelPin>;

/**
 * §5.1 — every field is optional at every layer, a ConfigLayer is a patch.
 * Fields use `.nullish()`, never `.optional()`: the merge rules distinguish
 * "absent" (do not override) from "explicitly null" (unset), and `.optional()`
 * cannot express the unset case at all.
 */
export const ConfigLayer = z.object({
  model: PartialModelPin.nullish(),
  qc: z
    .object({
      threshold: z.number().nullish(),
      model: PartialModelPin.nullish(),
      capUsd: z.number().nullish(),
    })
    .nullish(),
  budget: z
    .object({
      runCapUsd: z.number().nullish(),
      stageCapUsd: z.number().nullish(),
    })
    .nullish(),
  retryLimit: z.number().nullish(),
  iterate: z
    .object({
      itemRetryLimit: z.number().nullish(),
      maxItems: z.number().nullish(),
    })
    .nullish(),
  format: z
    .object({
      aspectRatio: z.string().nullish(),
      resolution: z.string().nullish(),
      fps: z.number().nullish(),
      targetDurationSec: z
        .object({ min: z.number().nullish(), max: z.number().nullish() })
        .nullish(),
    })
    .nullish(),
  provider: z
    .object({
      preferred: z.record(Modality, z.string()).nullish(),
    })
    .nullish(),
  polling: z
    .object({
      intervalSec: z.number().nullish(),
      maxWaitSec: z.number().nullish(),
    })
    .nullish(),
});
export type ConfigLayer = z.infer<typeof ConfigLayer>;
