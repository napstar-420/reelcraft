import { z } from 'zod';
import type { JsonSchema } from '@reelcraft/shared';
import type { QcEnvelope } from './qc-envelope';

export function qcVerdictSchema(envelope: QcEnvelope): JsonSchema {
  const properties: Record<string, JsonSchema> = {
    critique: { type: 'string' },
  };
  const required = ['critique'];
  if (envelope.dimensions?.length) {
    properties.dimensions = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', enum: envelope.dimensions.map((dimension) => dimension.key) },
          score: { type: 'number', minimum: 0, maximum: 100 },
          critique: { type: 'string' },
        },
        required: ['key', 'score', 'critique'],
      },
      minItems: envelope.dimensions.length,
      maxItems: envelope.dimensions.length,
    };
    required.push('dimensions');
  } else {
    properties.score = { type: 'number', minimum: 0, maximum: 100 };
    required.push('score');
  }
  if (envelope.selectBest) {
    properties.bestImage = {
      type: 'integer',
      enum: envelope.images?.map((image) => image.index) ?? [],
    };
    required.push('bestImage');
  }
  if (envelope.clips?.length) {
    properties.failedClips = { type: 'array', items: { type: 'integer' } };
    required.push('failedClips');
  }
  return { type: 'object', properties, required };
}

/** The judge model's raw structured-output contract — constructed fresh
 * over `unknown`, never wraps a `@reelcraft/shared` schema. */
export const JudgeResponse = z.object({
  dimensions: z
    .array(
      z.object({
        key: z.string(),
        score: z.number().min(0).max(100),
        critique: z.string().optional(),
      }),
    )
    .optional(),
  score: z.number().min(0).max(100).optional(),
  critique: z.string(),
  /** Clip lists only: the index of every clip that should be made again. */
  failedClips: z.array(z.number().int()).optional(),
  /** Candidate images only: the index of the best image, the one that was scored. */
  bestImage: z.number().int().optional(),
});
export type JudgeResponse = z.infer<typeof JudgeResponse>;

/** §10.3 — the host computes the final score as the weighted mean of
 * per-dimension scores; the judge's own self-reported top-level `score` is
 * never trusted when dimensions are declared. */
export function weightedScore(dimensions: Array<{ score: number; weight: number }>): number {
  const totalWeight = dimensions.reduce((sum, d) => sum + d.weight, 0);
  if (totalWeight === 0) return 0;
  const weightedSum = dimensions.reduce((sum, d) => sum + d.score * d.weight, 0);
  return weightedSum / totalWeight;
}
