import { z } from 'zod';
import { Ease, GraphicShape, TextRun } from './timeline';

const finiteNonNegative = z.number().finite().nonnegative();
const finitePositive = z.number().finite().positive();
const color = z.string().min(1).max(40);

/** What a layer is. */
export const PlanLayerKind = z.enum([
  'image',
  'video',
  'audio',
  'drawing',
  /** A motion graphic (Generate Motion Graphic's output), drawn from its code by the final render. */
  'motion',
  'text',
  'shape',
  'captions',
]);
export type PlanLayerKind = z.infer<typeof PlanLayerKind>;

export const PlanAnimType = z.enum([
  'draw',
  'handwrite',
  'pop',
  'fade',
  'slide',
  'highlight',
  'none',
]);

export const PlanKeyframe = z.object({
  atSec: finiteNonNegative,
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  scale: finitePositive.max(20).optional(),
  rotate: z.number().finite().optional(),
  opacity: z.number().min(0).max(1).optional(),
});
export type PlanKeyframe = z.infer<typeof PlanKeyframe>;

/**
 * One thing in a video: a picture, a clip, a sound, a drawing, some words, a shape or the
 * captions. A model decides where each goes (a box, as fractions of the frame) and when it
 * appears (a time, or a phrase from the narration). One flat shape on purpose: every field a
 * kind doesn't use is left out.
 */
export const PlanLayer = z.object({
  /** A name other layers can follow with `afterLayer`. */
  id: z.string().min(1).max(60).optional(),
  kind: PlanLayerKind,
  /** The row it sits on. Layers on one track share a type (video, audio, overlay or captions). */
  track: z.string().min(1).max(40).optional(),
  /** The asset an image, video, audio or drawing layer uses, by its id. */
  asset: z.string().min(1).max(100).optional(),
  /** The words of a text layer. */
  text: z.string().min(1).max(400).optional(),
  /** The words of a text layer in parts, each with its own colour, font or weight, instead of
   * `text`: one line with a word picked out. */
  runs: z.array(TextRun).min(1).max(20).optional(),
  shape: GraphicShape.optional(),

  /* When it appears: a time, a phrase said in the narration, or after another layer ends. */
  atSec: finiteNonNegative.optional(),
  atCue: z.string().min(1).max(200).optional(),
  afterLayer: z.string().min(1).max(60).optional(),
  /** Moves the start earlier (negative) or later. */
  offsetSec: z.number().finite().min(-30).max(30).optional(),
  /** How long it stays. Left out: until the video ends (a sound plays its own length). */
  durationSec: finitePositive.optional(),

  /* Where: x, y is the top left and w, h the size, as fractions of the frame (1 is the frame's
   * width or height). A world can be bigger than one frame. */
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  w: finitePositive.optional(),
  h: finitePositive.optional(),
  rotate: z.number().finite().optional(),
  z: z.number().finite().optional(),
  /** `world` moves with the camera; `screen` stays on the frame. Default `world`. */
  space: z.enum(['world', 'screen']).optional(),

  /* How it appears. */
  anim: PlanAnimType.optional(),
  animSec: finitePositive.optional(),
  from: z.enum(['left', 'right', 'top', 'bottom']).optional(),
  hand: z.enum(['none', 'marker', 'pencil']).optional(),
  keyframes: z.array(PlanKeyframe).max(20).optional(),

  /* Look of words, shapes and drawings. */
  color: color.optional(),
  /** Letter height for text, as a fraction of the frame's shorter side. It shrinks to fit the box. */
  size: finitePositive.max(2).optional(),
  font: z.string().min(1).max(80).optional(),
  weight: z.number().int().min(100).max(900).optional(),
  align: z.enum(['left', 'center', 'right']).optional(),

  /* Pictures, clips and sounds. */
  fit: z.enum(['cover', 'contain', 'fill']).optional(),
  trimInSec: finiteNonNegative.optional(),
  volume: z.number().min(0).max(2).optional(),
  fadeInSec: finiteNonNegative.optional(),
  fadeOutSec: finiteNonNegative.optional(),
  /** Repeat a sound to fill the time it plays for (music under a whole video). */
  loop: z.boolean().optional(),
  reveal: z.enum(['wipe_lr', 'circle', 'marker']).optional(),

  /** Captions: a caption template id. Default `caption.clean`. */
  style: z.string().min(1).max(80).optional(),
});
export type PlanLayer = z.infer<typeof PlanLayer>;

export const PlanCameraKey = z.object({
  atSec: finiteNonNegative.optional(),
  atCue: z.string().min(1).max(200).optional(),
  /** The centre of the view, in frames from the world's top left (0.5, 0.5 is the middle of the first frame). */
  x: z.number().finite(),
  y: z.number().finite(),
  /** 1 is a frame's worth; 2 is twice as close, 0.5 twice as far. */
  zoom: finitePositive.max(20).optional(),
  ease: Ease.optional(),
});
export type PlanCameraKey = z.infer<typeof PlanCameraKey>;

export const PlanTheme = z.object({
  paper: color.optional(),
  ink: color.optional(),
  highlight: color.optional(),
  accents: z.array(color).min(1).max(6).optional(),
  fontHand: z.string().min(1).max(80).optional(),
  fontBody: z.string().min(1).max(80).optional(),
  strokeWidth: z.number().positive().max(40).optional(),
  roughness: z.number().min(0).max(1).optional(),
  paperTexture: z.enum(['none', 'paper', 'grid']).optional(),
});
export type PlanTheme = z.infer<typeof PlanTheme>;

/** A video as layers a model placed. Compose Timeline turns it into a timeline. */
export const TimelinePlan = z.object({
  version: z.literal(1),
  /** The colour behind everything. Use an image layer for a picture. */
  background: color.optional(),
  theme: PlanTheme.optional(),
  /** How many frames wide and high the world is. Left out, it grows to hold every layer. */
  world: z.object({ width: finitePositive.max(50), height: finitePositive.max(50) }).optional(),
  camera: z.array(PlanCameraKey).max(100).optional(),
  /** Tracks whose volume drops while another track has something playing. */
  ducks: z
    .array(z.object({ track: z.string().min(1).max(40), under: z.string().min(1).max(40) }))
    .max(10)
    .optional(),
  /** How long the video is. Left out: as long as its longest sound, or its last layer. */
  durationSec: finitePositive.max(3600).optional(),
  layers: z.array(PlanLayer).min(1).max(300),
});
export type TimelinePlan = z.infer<typeof TimelinePlan>;
