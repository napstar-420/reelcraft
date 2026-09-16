import { z } from 'zod';

/** §17.1 — engine-owned schema; produced by llm.generate(timeline) and
 * consumed by timeline.render. */
export const TimelineItem = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('media'),
    handle: z.string(),
    startSec: z.number(),
    durationSec: z.number().optional(),
    trimInSec: z.number().optional(),
    fit: z.enum(['cover', 'contain', 'fill']).optional(),
    overflow: z.enum(['trim', 'loop', 'freeze', 'speed']).optional(),
    volume: z.number().optional(),
    fadeInSec: z.number().optional(),
    fadeOutSec: z.number().optional(),
    motion: z
      .object({
        type: z.enum(['ken_burns', 'zoom_in', 'pan']),
        intensity: z.number().optional(),
      })
      .optional(),
    transitionIn: z
      .object({
        type: z.enum(['cut', 'crossfade', 'slide', 'wipe']),
        durationSec: z.number(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal('text'),
    text: z.string(),
    startSec: z.number(),
    durationSec: z.number(),
    styleId: z.string(),
    position: z.union([
      z.enum(['top', 'center', 'bottom']),
      z.object({ x: z.number(), y: z.number() }),
    ]),
  }),
  z.object({
    type: z.literal('captions'),
    timingHandle: z.string(),
    styleId: z.string(),
    startSec: z.number().optional(),
  }),
]);
export type TimelineItem = z.infer<typeof TimelineItem>;

export const Track = z.object({
  id: z.string(),
  type: z.enum(['video', 'audio', 'overlay', 'captions']),
  duckUnder: z.string().optional(),
  items: z.array(TimelineItem),
});
export type Track = z.infer<typeof Track>;

export const Timeline = z.object({
  version: z.literal(1),
  canvas: z.object({
    width: z.number(),
    height: z.number(),
    fps: z.number(),
    background: z.string().optional(),
  }),
  tracks: z.array(Track),
});
export type Timeline = z.infer<typeof Timeline>;
