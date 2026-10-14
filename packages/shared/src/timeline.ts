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
/** How the word being spoken stands out in a caption. */
export const CaptionHighlightStyle = z.enum(['none', 'color', 'pill', 'underline', 'grow']);
export type CaptionHighlightStyle = z.infer<typeof CaptionHighlightStyle>;

export const CaptionStyleOverrides = z.object({
  wordsPerPage: z.number().int().min(1).max(8).optional(),
  highlightStyle: CaptionHighlightStyle.optional(),
  highlightColor: z.string().min(1).max(40).optional(),
  color: z.string().min(1).max(40).optional(),
  fontSize: z.number().min(16).max(200).optional(),
  uppercase: z.boolean().optional(),
  position: z.enum(['top', 'center', 'bottom']).optional(),
});
export type CaptionStyleOverrides = z.infer<typeof CaptionStyleOverrides>;

/** How a picture is uncovered as it appears. */
export const MediaReveal = z.object({
  type: z.enum(['wipe_lr', 'circle', 'marker']),
  /** How long it takes; left out, 0.8 seconds. */
  durationSec: finitePositive.optional(),
});
export type MediaReveal = z.infer<typeof MediaReveal>;

/** A transition at one end of a clip. */
export const MediaTransition = z.object({
  type: z.enum(['cut', 'crossfade', 'slide', 'wipe']),
  durationSec: finitePositive,
});
export type MediaTransition = z.infer<typeof MediaTransition>;

/** How a change eases: steady, slow in, slow out, or both. */
export const Ease = z.enum(['linear', 'in', 'out', 'in_out']);
export type Ease = z.infer<typeof Ease>;

/** One line to draw: SVG path data, in the item's own viewBox. */
export const SketchStroke = z.object({
  d: z.string().min(1).max(8000),
  /** A CSS colour, or a theme colour: `ink`, `paper`, `highlight`, `accent1`, `accent2`, `accent3`.
   * Left out, the line is `ink` unless it only has a fill. */
  color: z.string().min(1).max(40).optional(),
  /** Fills the shape, fading in once its line is drawn. */
  fill: z.string().min(1).max(40).optional(),
  /** How heavy the line is, against the theme's stroke width. */
  weight: z.enum(['thin', 'normal', 'bold']).optional(),
});
export type SketchStroke = z.infer<typeof SketchStroke>;

export const SketchShape = z.enum(['arrow', 'circle', 'underline', 'box', 'highlight', 'check']);
export type SketchShape = z.infer<typeof SketchShape>;

/** What a sketch item draws. */
export const SketchContent = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('paths'),
    viewBox: z.object({ width: finitePositive, height: finitePositive }),
    strokes: z.array(SketchStroke).min(1).max(60),
  }),
  z.object({
    kind: z.literal('text'),
    text: z.string().min(1).max(300),
    /** Letter height, in the item's units. */
    size: finitePositive.max(2000),
    color: z.string().min(1).max(40).optional(),
    font: z.enum(['hand', 'body']).optional(),
  }),
  z.object({
    kind: z.literal('shape'),
    shape: SketchShape,
    color: z.string().min(1).max(40).optional(),
  }),
]);
export type SketchContent = z.infer<typeof SketchContent>;

export const SketchAnim = z.object({
  type: z.enum(['draw', 'handwrite', 'pop', 'fade', 'slide', 'highlight', 'none']),
  /** How long the animation takes; left out, each kind has its own pace. */
  durationSec: finitePositive.optional(),
  ease: Ease.optional(),
  /** Where `slide` comes in from. */
  from: z.enum(['left', 'right', 'top', 'bottom']).optional(),
  /** A pen or marker that follows the line while it is drawn. */
  hand: z.enum(['none', 'marker', 'pencil']).optional(),
});
export type SketchAnim = z.infer<typeof SketchAnim>;

/** A small move after the item has appeared: where it is, how big, turned, how visible. Values
 * between two keys are blended. Times are from the item's own start. */
export const SketchKeyframe = z.object({
  atSec: finiteNonNegative,
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  scale: finitePositive.max(20).optional(),
  rotate: z.number().finite().optional(),
  opacity: z.number().min(0).max(1).optional(),
  ease: Ease.optional(),
});
export type SketchKeyframe = z.infer<typeof SketchKeyframe>;

/** Where the item's start came from: a word in the narration. The start time stays what counts;
 * this records it, so an editor can put it back after the item is moved. */
export const SketchCue = z.object({
  timingHandle: z.string(),
  phrase: z.string().min(1).max(200).optional(),
  wordIndex: z.number().int().nonnegative().optional(),
  offsetSec: z.number().finite().optional(),
});
export type SketchCue = z.infer<typeof SketchCue>;

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
    /** How the clip arrives. */
    transitionIn: MediaTransition.optional(),
    /** How the clip leaves, at its end: the same kinds as `transitionIn`, played backwards. */
    transitionOut: MediaTransition.optional(),
    /** Uncovers the picture as if it were drawn in, for a still image that should look sketched
     * on: a swipe from the left, a circle growing from the middle, or a marker swipe. */
    reveal: MediaReveal.optional(),
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
  z.object({
    type: z.literal('sketch'),
    /** Stable name for the item; seeds its hand-drawn wobble, so it looks the same on every render. */
    id: z.string().min(1).max(80).optional(),
    startSec: finiteNonNegative,
    durationSec: finitePositive,
    /** `world` sits on the big canvas the camera moves over; `screen` stays fixed on the frame. */
    space: z.enum(['world', 'screen']).optional(),
    /** The box it is drawn in, in the units of its space (the frame's pixels on screen). */
    x: z.number().finite(),
    y: z.number().finite(),
    w: finitePositive,
    h: finitePositive,
    rotate: z.number().finite().optional(),
    /** Stacking order among drawn items; higher is on top. */
    z: z.number().finite().optional(),
    content: SketchContent,
    anim: SketchAnim,
    keyframes: z.array(SketchKeyframe).max(50).optional(),
    cue: SketchCue.optional(),
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

/** The version a timeline has to be written as: 2 when it uses anything added after version 1,
 * otherwise 1. Pure, so the parse can set it and tests can check it. */
export function timelineVersionFor(timeline: {
  world?: unknown;
  camera?: unknown;
  theme?: unknown;
  tracks?: ReadonlyArray<{ items: ReadonlyArray<{ type: string; reveal?: unknown }> }>;
}): 1 | 2 {
  const newer = timeline.tracks?.some((track) =>
    track.items.some((item) => item.type === 'sketch' || item.reveal !== undefined),
  );
  return timeline.world || timeline.camera || timeline.theme || newer ? 2 : 1;
}

/** A big canvas the camera moves over, in its own units. Items with `space: 'world'` live on it. */
export const TimelineWorld = z.object({
  width: z.number().int().positive().max(20000),
  height: z.number().int().positive().max(20000),
});
export type TimelineWorld = z.infer<typeof TimelineWorld>;

export const CameraEase = Ease;
export type CameraEase = Ease;

/** Where the camera looks at `atSec`: the world point at the centre of the frame, and how far in. */
export const CameraKey = z.object({
  atSec: finiteNonNegative,
  cx: z.number().finite(),
  cy: z.number().finite(),
  /** 1 shows a part of the world as big as the frame; 2 is twice as close, 0.5 twice as far. */
  zoom: finitePositive.max(20),
  /** How the camera eases into this key from the one before. */
  ease: CameraEase.optional(),
});
export type CameraKey = z.infer<typeof CameraKey>;

export const TimelineCamera = z
  .object({ keys: z.array(CameraKey).min(1).max(200) })
  .superRefine((camera, ctx) => {
    for (let i = 1; i < camera.keys.length; i += 1) {
      if (camera.keys[i]!.atSec < camera.keys[i - 1]!.atSec) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['keys', i, 'atSec'],
          message: 'camera keys must be in time order',
        });
      }
    }
  });
export type TimelineCamera = z.infer<typeof TimelineCamera>;

/** The look of a hand-drawn video, so every drawn item follows one style. Colours and fonts are
 * values, not names, so the render needs nothing from the API. */
export const TimelineTheme = z.object({
  paper: z.string().min(1).max(40),
  ink: z.string().min(1).max(40),
  highlight: z.string().min(1).max(40),
  accents: z.array(z.string().min(1).max(40)).min(1).max(6),
  fontHand: z.string().min(1).max(80),
  fontBody: z.string().min(1).max(80),
  /** Line weight, in world units. */
  strokeWidth: z.number().positive().max(40),
  /** How wobbly lines are drawn, 0 (clean) to 1. */
  roughness: z.number().min(0).max(1),
  paperTexture: z.enum(['none', 'paper', 'grid']).optional(),
});
export type TimelineTheme = z.infer<typeof TimelineTheme>;

/** Which tracks each kind of item can sit on. */
export const ITEM_TRACKS = {
  media: ['video', 'audio', 'overlay'],
  text: ['overlay'],
  captions: ['captions'],
  sketch: ['overlay'],
} as const satisfies Record<TimelineItem['type'], ReadonlyArray<Track['type']>>;

export const Timeline = z
  .object({
    /** 1 until a timeline uses something added later (a world, camera or theme), then 2. Older
     * releases reject 2 instead of silently dropping what they don't know. The parse sets it. */
    version: z.union([z.literal(1), z.literal(2)]),
    canvas: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      fps: finitePositive,
      background: z.string().optional(),
    }),
    tracks: z.array(Track),
    world: TimelineWorld.optional(),
    camera: TimelineCamera.optional(),
    theme: TimelineTheme.optional(),
  })
  .superRefine((timeline, ctx) => {
    if (timeline.camera && !timeline.world) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['camera'],
        message: 'a camera needs a world to move over',
      });
    }
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
        const compatible = (ITEM_TRACKS[item.type] as readonly string[]).includes(track.type);
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
          item.transitionIn &&
          item.transitionOut &&
          item.transitionIn.type !== 'cut' &&
          item.transitionOut.type !== 'cut' &&
          item.transitionIn.durationSec + item.transitionOut.durationSec > item.durationSec + 0.001
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['tracks', trackIndex, 'items', itemIndex],
            message: 'combined transitions cannot exceed item duration',
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
  })
  .transform((timeline) => ({ ...timeline, version: timelineVersionFor(timeline) }));
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
  italic: z.boolean().optional(),
  /** Space between letters, in em. */
  letterSpacingEm: z.number().min(-0.2).max(1).optional(),
  /** Horizontal alignment; a lower third sits left. */
  align: z.enum(['left', 'center']).optional(),
  /** What a caption template sets besides how its text looks: how the spoken word stands out, how
   * many words show at once, and where. A person's own choices on a captions item win over these. */
  caption: z
    .object({
      wordsPerPage: z.number().int().min(1).max(8),
      position: z.enum(['top', 'center', 'bottom']),
      highlight: z.object({
        style: CaptionHighlightStyle,
        color: z.string(),
        /** The colour of the word itself when its highlight is a box (`pill`). */
        textColor: z.string().optional(),
      }),
    })
    .optional(),
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
