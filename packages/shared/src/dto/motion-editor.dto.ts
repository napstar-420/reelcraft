import { z } from 'zod';
import { MOTION_LIMITS, MotionSource } from '../motion-source';

export const MotionCheckDto = z.object({ code: z.string().max(MOTION_LIMITS.codeBytes * 2) });
export type MotionCheckDto = z.infer<typeof MotionCheckDto>;

/** One rule a motion graphic's code breaks. */
export const MotionIssueDto = z.object({
  code: z.string(),
  message: z.string(),
  line: z.number().int().optional(),
});
export type MotionIssueDto = z.infer<typeof MotionIssueDto>;

export const MotionCheckResultDto = z.object({ issues: z.array(MotionIssueDto) });
export type MotionCheckResultDto = z.infer<typeof MotionCheckResultDto>;

export const StartMotionPreviewDto = z.object({ source: MotionSource });
export type StartMotionPreviewDto = z.infer<typeof StartMotionPreviewDto>;

/** Pictures of a motion graphic's start, middle and end, rendered while it is being edited. */
export const MotionPreviewDto = z.object({
  id: z.string(),
  state: z.enum(['rendering', 'done', 'failed', 'invalid', 'expired']),
  /** PNG data URLs, start to end, once done. */
  stills: z.array(z.string()).optional(),
  error: z.string().optional(),
  issues: z.array(MotionIssueDto).optional(),
});
export type MotionPreviewDto = z.infer<typeof MotionPreviewDto>;
