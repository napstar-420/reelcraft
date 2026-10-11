import { z } from 'zod';

const finiteNonNegative = z.number().finite().nonnegative();
const finitePositive = z.number().finite().positive();

/** §17.1 — engine-owned schema; produced by text.generate(timeline) and
 * consumed by timeline.render. */
/** One word of a caption page and when it is spoken. */
export const CaptionWordDef = z
  .object({
    text: z.string().min(1),
    startSec: finiteNonNegative,
    endSec: finiteNonNegative,
  })
  .refine((word) => word.endSec >= word.startSec, {
    message: 'a word cannot end before it starts',
  });

/** A few words shown together. Words are in the order they are spoken. */
export const CaptionPageDef = z
  .object({ words: z.array(CaptionWordDef).min(1).max(24) })
  .superRefine((page, ctx) => {
    for (let i = 1; i < page.words.length; i += 1) {
      if (page.words[i]!.startSec < page.words[i - 1]!.startSec) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['words', i, 'startSec'],
          message: 'words must be in the order they are spoken',
        });
      }
    }
  });
export type CaptionPageDef = z.infer<typeof CaptionPageDef>;

/** What a captions item can change about its preset. Fonts are left to the preset on purpose: the
 * render can only use fonts it has. */
export const CaptionStyleOverrides = z.object({
  wordsPerPage: z.number().int().min(1).max(8).optional(),
  highlightColor: z.string().min(1).max(40).optional(),
  color: z.string().min(1).max(40).optional(),
  fontSize: z.number().min(16).max(200).optional(),
  uppercase: z.boolean().optional(),
  position: z.enum(['top', 'center', 'bottom']).optional(),
});
export type CaptionStyleOverrides = z.infer<typeof CaptionStyleOverrides>;

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
    /** How the captions are broken into pages. When present, these replace the automatic paging
     * of the transcript, so a person can fix a wrong word or move a break. */
    pages: z.array(CaptionPageDef).optional(),
    /** Looks that override the style preset for this captions item only. */
    style: CaptionStyleOverrides.optional(),
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
  /** What to show the person instead of the handle: the clip's name, or where it came from. */
  label: z.string().optional(),
  probe: z.unknown().optional(),
});
export type TimelineResource = z.infer<typeof TimelineResource>;

/** How a text or caption style looks when rendered. Plain values (no CSS
 * strings to parse) so the renderer and the editor preview draw the same. */
export const TextStyleTokens = z.object({
  color: z.string(),
  fontFamily: z.string(),
  fontSize: z.number().positive(),
  fontWeight: z.number().int().min(100).max(1000),
  /** Text outline, drawn behind the fill. */
  stroke: z.object({ color: z.string(), width: z.number().nonnegative() }).optional(),
  shadow: z.string().optional(),
  /** A box behind the text. */
  background: z
    .object({ color: z.string(), paddingEm: z.number().nonnegative(), radius: z.number() })
    .optional(),
  uppercase: z.boolean().optional(),
  /** Horizontal alignment; a lower third sits left. */
  align: z.enum(['left', 'center']).optional(),
});
export type TextStyleTokens = z.infer<typeof TextStyleTokens>;

export const TimelineStyle = z.object({
  id: z.string(),
  label: z.string(),
  category: z.enum(['caption', 'text', 'lower_third']),
  description: z.string(),
  supportedItemTypes: z.array(z.enum(['text', 'captions'])),
  tokens: TextStyleTokens.optional(),
});
export type TimelineStyle = z.infer<typeof TimelineStyle>;
