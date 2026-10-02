import { z } from 'zod';

/** §23 — fail fast on a missing or malformed variable; no `process.env`
 * reads anywhere else in the codebase. */
export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).optional(),
    API_PORT: z.coerce.number().default(3000),
    /** Shown by the health endpoint; set by the self-hosted image build. */
    REELCRAFT_VERSION: z.string().min(1).optional(),
    /** When set, the API serves the built web app from this directory. */
    WEB_DIST_DIR: z.string().min(1).optional(),
    /** Unix socket of the self-hosted image's update agent. */
    REELCRAFT_UPDATER_SOCKET: z.string().min(1).optional(),

    DATABASE_URL: z.string().url(),

    S3_ENDPOINT: z.string().url(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default('video-engine'),
    S3_ACCESS_KEY_ID: z.string(),
    S3_SECRET_ACCESS_KEY: z.string(),
    S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
    /** When set (e.g. `/storage`), browser-facing presigned URLs become
     * relative to this path, which the API proxies to S3_ENDPOINT. Lets a
     * single-port deployment keep MinIO private. */
    S3_BROWSER_PATH_PREFIX: z
      .string()
      .regex(/^\/[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*$/, 'must be a path like /storage')
      .optional(),

    PRESIGN_TTL_SEC: z.coerce.number().default(900),

    INNGEST_BASE_URL: z.string().url(),
    INNGEST_EVENT_KEY: z.string(),
    INNGEST_SIGNING_KEY: z.string(),
    /** Register with Inngest right after boot and report unhealthy until it
     * succeeds (self-hosted image). Off in dev, where `inngest start
     * --sdk-url` syncs on its own and nothing waits on health. */
    INNGEST_SYNC_ON_BOOT: z.enum(['true', 'false']).optional(),

    OPENROUTER_API_KEY: z.string().optional(),
    FAL_KEY: z.string().optional(),
    ELEVENLABS_API_KEY: z.string().optional(),
    DEEPGRAM_API_KEY: z.string().optional(),
    PUBLIC_API_BASE_URL: z.string().url().optional(),
    DEEPGRAM_CALLBACK_SECRET: z.string().min(32).optional(),

    WORKSPACE_ROOT: z.string().default('./.workspace'),
    CODEX_PROFILE: z.string().min(1).optional(),
    CODEX_IMAGE_EXTENSION: z.string().min(1).optional(),
    CODEX_BROWSER_EXTENSION: z.string().min(1).optional(),
    CODEX_BROWSER_OS_URL: z.string().url().optional(),
    CODEX_READINESS_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
    CODEX_JOB_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
    CODEX_BROWSER_MAX_STEPS: z.coerce.number().int().positive().max(500).optional(),
    CODEX_OUTPUT_MAX_BYTES: z.coerce.number().int().positive().optional(),
    COMPUTE_MIN_FREE_BYTES: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(5 * 1024 * 1024 * 1024),
    COMPUTE_JOB_RETENTION_SEC: z.coerce.number().int().positive().default(86_400),
    REMOTION_BROWSER_EXECUTABLE: z.string().optional(),
    BLOB_RETENTION_DAYS: z.coerce.number().default(30),
    ITERATE_MAX_ITEMS: z.coerce.number().default(50),
    PRE_SUBMIT_TTL_SEC: z.coerce.number().default(600),
    FETCH_ALLOWANCE_SEC: z.coerce.number().default(120),
    QC_ERROR_RETRIES: z.coerce.number().default(2),
    INFRA_RETRIES: z.coerce.number().default(2),
    SANDBOX_MEMORY_MB: z.coerce.number().default(32),
    SANDBOX_TIMEOUT_MS: z.coerce.number().default(100),

    PREVIEW_TOKEN_SECRET: z.string().min(32).optional(),
    PREVIEW_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(600),
    /** Encrypts provider keys saved in Settings; defaults to a key derived
     * from PREVIEW_TOKEN_SECRET. */
    SETTINGS_ENCRYPTION_KEY: z.string().min(32).optional(),
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV !== 'test' && env.PREVIEW_TOKEN_SECRET === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PREVIEW_TOKEN_SECRET'],
        message: 'PREVIEW_TOKEN_SECRET is required outside tests',
      });
    }
  });
export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = EnvSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${parsed.error.toString()}`);
  }
  return parsed.data;
}
