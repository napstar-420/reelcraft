import { z } from 'zod';
import { GraphicStroke } from './timeline';

/** What a drawing's id looks like. */
export const ASSET_ID = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

/**
 * A drawing a video can use: lines in the order they are drawn, on a 0 to `viewBox` grid.
 * Colours are theme colours (`ink`, `accent1`, ...) or CSS colours, so one drawing takes on
 * whichever theme a video has.
 */
export const VectorAsset = z.object({
  /** Lowercase words joined by `-` or `_`, such as `arrow-right`. */
  id: z.string().regex(ASSET_ID),
  /** What it is, in a few words. */
  label: z.string().min(1).max(120),
  viewBox: z.object({
    width: z.number().positive().max(1000),
    height: z.number().positive().max(1000),
  }),
  strokes: z.array(GraphicStroke).min(1).max(60),
  /** Where the drawing came from: made for this run, uploaded to the channel library, or built
   * into Reelcraft. */
  source: z.enum(['generated', 'library', 'builtin']),
});
export type VectorAsset = z.infer<typeof VectorAsset>;

/** The drawings a run has made, ready to place. */
export const VectorAssetSet = z.object({
  assets: z.array(VectorAsset).max(100),
});
export type VectorAssetSet = z.infer<typeof VectorAssetSet>;

/** A drawing a plan asks to have made: what it is and what it should look like. */
export const DrawingNeed = z.object({
  id: z.string().regex(ASSET_ID),
  /** What it is, in a few words. */
  label: z.string().min(1).max(120),
  /** What it should look like. */
  description: z.string().min(1).max(400),
  /** A built-in drawing to use instead if this one can't be made. */
  fallbackId: z.string().regex(ASSET_ID).optional(),
});
export type DrawingNeed = z.infer<typeof DrawingNeed>;
