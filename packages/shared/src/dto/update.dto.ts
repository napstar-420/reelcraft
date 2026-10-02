import { z } from 'zod';

/** What the in-app updater is doing right now. */
export const UpdatePhase = z.enum([
  'idle',
  'checking',
  'downloading',
  'verifying',
  'installing',
  'backing-up',
  'restarting',
  'rolling-back',
]);
export type UpdatePhase = z.infer<typeof UpdatePhase>;

/** The newest published release, as last seen on GitHub. */
export const LatestReleaseDto = z.object({
  version: z.string(),
  tag: z.string(),
  url: z.string().nullable(),
  /** Release notes (Markdown source), shown as plain text. */
  notes: z.string(),
  publishedAt: z.string().nullable(),
  /** Newer than the version running now. */
  newer: z.boolean(),
  /** Image runtime the release needs; null unless it is newer. */
  runtime: z.number().int().nullable(),
  /** The release can't install in-app: the Docker image must be updated. */
  needsImage: z.boolean(),
});
export type LatestReleaseDto = z.infer<typeof LatestReleaseDto>;

export const UpdateResultDto = z.object({
  ok: z.boolean(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  at: z.string(),
  error: z.string().optional(),
});
export type UpdateResultDto = z.infer<typeof UpdateResultDto>;

/** `GET /api/system/update`. `managed` is false outside the self-hosted
 * image (for example under `pnpm dev`), where the app can't update itself. */
export const UpdateStatusDto = z.object({
  managed: z.boolean(),
  current: z.object({
    version: z.string(),
    /** `image`: the bundle the Docker image shipped; `active`/`trial`: an
     * in-app update. */
    source: z.enum(['image', 'active', 'trial']),
  }),
  image: z.object({ version: z.string(), runtime: z.number().int() }).nullable(),
  updatesEnabled: z.boolean(),
  latest: LatestReleaseDto.nullable(),
  phase: UpdatePhase,
  progress: z.object({ received: z.number(), total: z.number() }).nullable(),
  lastCheckedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  lastResult: UpdateResultDto.nullable(),
  /** Runs executing right now; an update restarts the app and interrupts them. */
  activeRuns: z.number().int().nonnegative(),
});
export type UpdateStatusDto = z.infer<typeof UpdateStatusDto>;

/** `POST /api/system/update/install` */
export const InstallUpdateDto = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, 'expected a release version'),
});
export type InstallUpdateDto = z.infer<typeof InstallUpdateDto>;
