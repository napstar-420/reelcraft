import { z } from 'zod';
import type { JsonSchema } from './json-schema';

/** The packages a motion graphic's code may import. Everything else is refused. */
export const MOTION_IMPORTS = [
  'react',
  'remotion',
  '@remotion/paths',
  '@remotion/shapes',
  '@remotion/transitions',
  '@remotion/noise',
  '@remotion/animation-utils',
] as const;

export const MOTION_LIMITS = {
  codeBytes: 64 * 1024,
  minSec: 1,
  maxSec: 60,
  maxSide: 3840,
  maxAssets: 20,
  propsBytes: 64 * 1024,
} as const;

/** A file the code can load with `staticFile(name)`: an image or drawing the stage was given. */
export const MotionAssetRef = z.object({
  /** The file name the code uses, such as `logo.png`. */
  name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/),
  /** Where the file comes from: an artifact or asset handle. */
  handle: z.string().min(1),
});
export type MotionAssetRef = z.infer<typeof MotionAssetRef>;

/**
 * A motion graphic: one Remotion component and what it needs to render. Size, frame rate and
 * length live here, never in the code, which reads them from `useVideoConfig()`.
 */
export const MotionSource = z.object({
  version: z.literal(1),
  /** One TSX module whose default export is the component. It is given `props`. */
  code: z.string().min(1).max(MOTION_LIMITS.codeBytes),
  width: z.number().int().min(16).max(MOTION_LIMITS.maxSide),
  height: z.number().int().min(16).max(MOTION_LIMITS.maxSide),
  fps: z.number().int().min(1).max(60),
  durationSec: z.number().min(MOTION_LIMITS.minSec).max(MOTION_LIMITS.maxSec),
  /** `transparent` renders a clip with an alpha channel, to lay over other layers. */
  background: z.enum(['transparent', 'opaque']),
  /** Data the component is given, such as chart numbers or labels. */
  props: z.record(z.unknown()).optional(),
  assets: z.array(MotionAssetRef).max(MOTION_LIMITS.maxAssets).optional(),
  /** What the graphic shows, in a sentence, from the model. */
  notes: z.string().max(1000).optional(),
});
export type MotionSource = z.infer<typeof MotionSource>;

/** What a model writing a motion graphic answers with; the stage adds the rest. */
export const MotionAnswer = z.object({
  code: z.string().min(1).max(MOTION_LIMITS.codeBytes),
  /** How long the graphic runs, when the stage left it to the model. */
  durationSec: z.number().min(MOTION_LIMITS.minSec).max(MOTION_LIMITS.maxSec).optional(),
  notes: z.string().max(1000).optional(),
});
export type MotionAnswer = z.infer<typeof MotionAnswer>;

/** The answer's shape as JSON Schema, for structured output. Kept flat so every provider accepts it. */
export const motionAnswerJsonSchema: JsonSchema = {
  type: 'object',
  required: ['code', 'durationSec', 'notes'],
  properties: {
    code: {
      type: 'string',
      description: 'One TSX module. Its default export is a React component that takes the props.',
    },
    durationSec: {
      type: 'number',
      description: `How long the graphic runs, ${MOTION_LIMITS.minSec} to ${MOTION_LIMITS.maxSec} seconds.`,
    },
    notes: { type: 'string', description: 'What the graphic shows, in one sentence.' },
  },
};

/** A motion graphic's shape, for a stage's data output (Generate Motion Graphic's result). */
export const motionSourceJsonSchema: JsonSchema = {
  type: 'object',
  required: ['version', 'code', 'width', 'height', 'fps', 'durationSec', 'background'],
  properties: {
    version: { type: 'integer', minimum: 1, maximum: 1 },
    code: { type: 'string', minLength: 1, maxLength: MOTION_LIMITS.codeBytes },
    width: { type: 'integer', minimum: 16, maximum: MOTION_LIMITS.maxSide },
    height: { type: 'integer', minimum: 16, maximum: MOTION_LIMITS.maxSide },
    fps: { type: 'integer', minimum: 1, maximum: 60 },
    durationSec: { type: 'number', minimum: MOTION_LIMITS.minSec, maximum: MOTION_LIMITS.maxSec },
    background: { type: 'string', enum: ['transparent', 'opaque'] },
    props: { type: 'object', description: 'Data the component is given' },
    assets: {
      type: 'array',
      maxItems: MOTION_LIMITS.maxAssets,
      items: {
        type: 'object',
        required: ['name', 'handle'],
        properties: { name: { type: 'string' }, handle: { type: 'string' } },
      },
    },
    notes: { type: 'string' },
  },
};
