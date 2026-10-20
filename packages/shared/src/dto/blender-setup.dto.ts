import { z } from 'zod';

/** Where the Blender Reelcraft uses was found. */
export const BlenderSource = z.enum([
  /** A path saved in Settings. */
  'saved',
  /** `BLENDER_PATH` in the environment. */
  'env',
  /** The copy Reelcraft downloaded. */
  'managed',
  /** A copy already installed on this computer. */
  'found',
]);
export type BlenderSource = z.infer<typeof BlenderSource>;

/** A GPU Blender's Cycles renderer can use, by the backend that drives it. */
export const BlenderDevice = z.object({
  backend: z.enum(['OPTIX', 'CUDA', 'HIP', 'METAL', 'ONEAPI']),
  name: z.string(),
});
export type BlenderDevice = z.infer<typeof BlenderDevice>;

/** Backs `GET /blender/setup`. */
export const BlenderSetupDto = z.object({
  /** The Blender in use, or null when none was found. */
  path: z.string().nullable(),
  source: BlenderSource.nullable(),
  /** What `bpy.app.version_string` reports. */
  version: z.string().nullable(),
  /** The GPUs it can render with. Empty means it renders on the CPU. */
  devices: z.array(BlenderDevice),
  /** Why Blender can't be used, when it can't. */
  error: z.string().nullable(),
  /** The version Reelcraft downloads, and how big the download is, when there is one for this
   * computer (Linux x64 and Windows). Elsewhere Blender is installed by hand. */
  download: z.object({ version: z.string(), bytes: z.number() }).nullable(),
  install: z.object({
    state: z.enum(['idle', 'downloading', 'extracting', 'failed']),
    receivedBytes: z.number(),
    error: z.string().nullable(),
  }),
  /** Where a downloaded Blender is kept. */
  homeDir: z.string(),
  /** Reelcraft runs inside a Docker container. */
  inContainer: z.boolean(),
});
export type BlenderSetupDto = z.infer<typeof BlenderSetupDto>;

/** Use the Blender at this path; null goes back to finding one. */
export const SaveBlenderPathDto = z.object({
  path: z.string().trim().min(1).max(1024).nullable(),
});
export type SaveBlenderPathDto = z.infer<typeof SaveBlenderPathDto>;
