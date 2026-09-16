import { z } from 'zod';
import { ModelPin } from './config-layer';

/**
 * §2.7 / §10 — QC is forbidden on video output (human approval replaces it);
 * enforced by the validator, not by this schema. `media.includeTranscript`
 * only makes sense for audio.
 */
export const QcDef = z.object({
  criteria: z.string(),
  threshold: z.number(),
  model: ModelPin,
  includeInputs: z.boolean(),
  media: z.object({ includeTranscript: z.boolean().optional() }).optional(),
  dimensions: z
    .array(z.object({ key: z.string(), description: z.string(), weight: z.number() }))
    .optional(),
});
export type QcDef = z.infer<typeof QcDef>;
