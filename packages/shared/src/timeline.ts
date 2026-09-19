import { z } from 'zod';

const finiteNonNegative = z.number().finite().nonnegative();
const finitePositive = z.number().finite().positive();

/** §17.1 — engine-owned schema; produced by llm.generate(timeline) and
 * consumed by timeline.render. */
export const TimelineItem = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('media'),
    handle: z.string(),
    startSec: finiteNonNegative,
    durationSec: finitePositive.optional(),
    trimInSec: finiteNonNegative.optional(),
    fit: z.enum(['cover', 'contain', 'fill']).optional(),
    overflow: z.enum(['trim', 'loop', 'freeze', 'speed']).optional(),
    volume: z.number().finite().min(0).max(2).optional(),
    fadeInSec: finiteNonNegative.optional(),
    fadeOutSec: finiteNonNegative.optional(),
    motion: z
      .object({
        type: z.enum(['ken_burns', 'zoom_in', 'pan']),
        intensity: z.number().finite().min(0).max(1).optional(),
      })
      .optional(),
    transitionIn: z
      .object({
        type: z.enum(['cut', 'crossfade', 'slide', 'wipe']),
        durationSec: finitePositive,
      })
      .optional(),
  }),
  z.object({
    type: z.literal('text'),
    text: z.string(),
    startSec: finiteNonNegative,
    durationSec: finitePositive,
    styleId: z.string(),
    position: z.union([
      z.enum(['top', 'center', 'bottom']),
      z.object({ x: z.number().finite(), y: z.number().finite() }),
    ]),
  }),
  z.object({
    type: z.literal('captions'),
    timingHandle: z.string(),
    styleId: z.string(),
    startSec: finiteNonNegative.optional(),
  }),
]);
export type TimelineItem = z.infer<typeof TimelineItem>;

export const Track = z.object({
  id: z.string().min(1),
  type: z.enum(['video', 'audio', 'overlay', 'captions']),
  duckUnder: z.string().optional(),
  items: z.array(TimelineItem),
});
export type Track = z.infer<typeof Track>;

export const Timeline = z
  .object({
    version: z.literal(1),
    canvas: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      fps: finitePositive,
      background: z.string().optional(),
    }),
    tracks: z.array(Track),
  })
  .superRefine((timeline, ctx) => {
    const ids = new Set<string>();
    for (const [trackIndex, track] of timeline.tracks.entries()) {
      if (ids.has(track.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tracks', trackIndex, 'id'],
          message: `duplicate track id "${track.id}"`,
        });
      }
      ids.add(track.id);
      if (track.duckUnder && track.type !== 'audio') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tracks', trackIndex, 'duckUnder'],
          message: 'duckUnder is only valid on audio tracks',
        });
      }
      for (const [itemIndex, item] of track.items.entries()) {
        const compatible =
          item.type === 'media'
            ? track.type === 'video' || track.type === 'audio' || track.type === 'overlay'
            : item.type === 'text'
              ? track.type === 'overlay'
              : track.type === 'captions';
        if (!compatible) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['tracks', trackIndex, 'items', itemIndex],
            message: `${item.type} item is not valid on a ${track.type} track`,
          });
        }
        if (
          item.type === 'media' &&
          item.durationSec !== undefined &&
          (item.fadeInSec ?? 0) + (item.fadeOutSec ?? 0) > item.durationSec
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['tracks', trackIndex, 'items', itemIndex],
            message: 'combined fades cannot exceed item duration',
          });
        }
      }
    }
    for (const [trackIndex, track] of timeline.tracks.entries()) {
      if (track.duckUnder && !ids.has(track.duckUnder)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tracks', trackIndex, 'duckUnder'],
          message: `duckUnder references unknown track "${track.duckUnder}"`,
        });
      }
    }
  });
export type Timeline = z.infer<typeof Timeline>;

export const TimelineResource = z.object({
  handle: z.string(),
  kind: z.enum(['media.image', 'media.video', 'media.audio']),
  url: z.string(),
  probe: z.unknown().optional(),
});
export type TimelineResource = z.infer<typeof TimelineResource>;

export const TimelineStyle = z.object({
  id: z.string(),
  label: z.string(),
  category: z.enum(['caption', 'text', 'lower_third']),
  description: z.string(),
  supportedItemTypes: z.array(z.enum(['text', 'captions'])),
});
export type TimelineStyle = z.infer<typeof TimelineStyle>;
