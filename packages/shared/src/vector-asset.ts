import { z } from 'zod';
import { SketchStroke } from './timeline';

/**
 * A drawing a video can use: lines in the order they are drawn, on a 0 to `viewBox` grid.
 * Colours are theme colours (`ink`, `accent1`, ...) or CSS colours, so one drawing takes on
 * whichever theme a video has.
 */
export const VectorAsset = z.object({
  /** Lowercase words joined by `-` or `_`, such as `arrow-right`. */
  id: z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,63}$/),
  /** What it is, in a few words. */
  label: z.string().min(1).max(120),
  viewBox: z.object({
    width: z.number().positive().max(1000),
    height: z.number().positive().max(1000),
  }),
  strokes: z.array(SketchStroke).min(1).max(60),
  /** Where the drawing came from: made for this run, or built into Reelcraft. */
  source: z.enum(['generated', 'registry']),
});
export type VectorAsset = z.infer<typeof VectorAsset>;
