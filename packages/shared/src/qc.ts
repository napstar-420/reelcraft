import { z } from 'zod';
import { ModelPin } from './config-layer';

/** Default cap on QC-rejected (and check-failed) regenerations per round
 * when a stage leaves `qc.maxAttempts` / `checkMaxAttempts` unset. */
export const DEFAULT_FEEDBACK_MAX_ATTEMPTS = 3;

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
  /** Failed verdicts allowed before QC gives up; each failure regenerates
   * with the critique. Independent of `StageDef.retryLimit` (crashes only). */
  maxAttempts: z.number().int().min(1).optional(),
  /** What happens once `maxAttempts` is spent: fail the stage, or hand the
   * last output to a human for approve/reject. Defaults to `fail`. */
  onExhausted: z.enum(['fail', 'human_review']).optional(),
});
export type QcDef = z.infer<typeof QcDef>;
