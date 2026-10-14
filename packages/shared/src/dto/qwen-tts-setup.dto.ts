import { z } from 'zod';

/**
 * Setting up the local Qwen3-TTS service from the app: installing its Python packages with `uv`,
 * starting it when it is needed and stopping it when it is not.
 */

export const QwenTtsSetupPhase = z.enum([
  /** Reelcraft has no copy of the service to run (not a source checkout, not the image). */
  'unavailable',
  /** `uv`, which installs the packages, is not on this computer. */
  'needs-uv',
  'not-installed',
  /** Installed, but for a different version of the packages than this Reelcraft wants. */
  'outdated',
  'installing',
  'install-failed',
  'stopped',
  'starting',
  'running',
  'stopping',
  /** It crashed, or did not come up. */
  'failed',
]);
export type QwenTtsSetupPhase = z.infer<typeof QwenTtsSetupPhase>;

/** Which PyTorch build to install: the one for this computer's GPU, or the CPU one. */
export const QwenTtsBackend = z.enum(['auto', 'cpu']);
export type QwenTtsBackend = z.infer<typeof QwenTtsBackend>;

/** Backs `GET /qwen-tts/setup`. */
export const QwenTtsSetupDto = z.object({
  /** `managed`: Reelcraft installs and runs the service. `external`: the user runs it and saved its address. */
  mode: z.enum(['managed', 'external']),
  phase: QwenTtsSetupPhase,
  /** Why it is unavailable, or what went wrong. */
  error: z.string().nullable(),
  /** Reelcraft started the running service, so it can stop it. False for one the user started. */
  owned: z.boolean(),
  /** The device the model uses (`cuda:0`, `mps`, `cpu`), once the service has worked it out. */
  device: z.string().nullable(),
  /** The device for people: `Apple GPU (MPS)`, `NVIDIA … (CUDA)`, `CPU`. */
  deviceLabel: z.string().nullable(),
  /** Why it is the CPU, when it is. */
  deviceReason: z.string().nullable(),
  uv: z.object({ path: z.string(), version: z.string() }).nullable(),
  /** The NVIDIA GPU this computer (or the Docker container) can see, by name. */
  nvidiaGpu: z.string().nullable(),
  /** Reelcraft runs inside a Docker container. */
  inContainer: z.boolean(),
  /** Where the packages and models are kept. */
  homeDir: z.string(),
  sizes: z.object({
    /** What installing the packages downloads. */
    packagesBytes: z.number(),
    /** The size is a guess (an NVIDIA build was not measured). */
    packagesEstimated: z.boolean(),
    freeBytes: z.number().nullable(),
  }),
  /** The tail of the install or service output. */
  log: z.string(),
  startedAt: z.string().nullable(),
});
export type QwenTtsSetupDto = z.infer<typeof QwenTtsSetupDto>;

/** Body of `POST /qwen-tts/setup/install`. */
export const QwenTtsInstallDto = z.object({ backend: QwenTtsBackend.default('auto') });
export type QwenTtsInstallDto = z.infer<typeof QwenTtsInstallDto>;

/** Body of `POST /qwen-tts/models/link`: use model files the user already has, in place. */
export const LinkQwenModelDto = z.object({
  modelId: z.string().min(1).max(200),
  path: z.string().trim().min(1).max(1000),
});
export type LinkQwenModelDto = z.infer<typeof LinkQwenModelDto>;
