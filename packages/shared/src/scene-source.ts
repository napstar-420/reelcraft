import { z } from 'zod';

/** The programs a scene can be written for. Each engine is one renderer; the program is its code. */
export const SceneEngine = z.enum(['blender']);
export type SceneEngine = z.infer<typeof SceneEngine>;

/** Bumped when the `build(rc)` contract a scene script is written against changes. */
export const SCENE_CONTRACT_VERSION = 1;

/** What a scene script calls an asset (`rc.asset('hero')`): letters, digits, `-` and `_`. */
export const SCENE_ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

/** One file a scene uses, by the name its script knows it by and the handle Reelcraft stores it under. */
export const SceneAsset = z.object({
  name: z.string().regex(SCENE_ASSET_NAME),
  kind: z.enum(['image', 'video', 'audio', 'model']),
  /** `artifact:<id>`, `artifact:<id>#<n>` or `asset:<id>`. */
  handle: z.string().min(1).max(300),
});
export type SceneAsset = z.infer<typeof SceneAsset>;

/**
 * A scene program: code a model wrote for an engine, the files it may load and the data it reads.
 * Rendering it again gives the same frames, so it can be rendered as a draft, then final, or
 * exported as a model, without asking a model again.
 */
export const SceneSource = z.object({
  engine: SceneEngine,
  contractVersion: z.literal(SCENE_CONTRACT_VERSION),
  /** The program. For Blender, a Python module defining `build(rc)`. */
  script: z.string().min(1).max(1_000_000),
  assets: z.array(SceneAsset).max(200),
  /** Data the script reads as `rc.data[name]`, e.g. a voice-over's word timings. */
  data: z.record(z.string(), z.unknown()).optional(),
  width: z.number().int().min(16).max(8192),
  height: z.number().int().min(16).max(8192),
  fps: z.number().int().min(1).max(120),
  durationSec: z.number().positive().max(36_000),
  /** Render with a transparent background (a clip to lay over others). */
  transparent: z.boolean().default(false),
});
export type SceneSource = z.infer<typeof SceneSource>;
