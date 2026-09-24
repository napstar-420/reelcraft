import { z } from 'zod';

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
