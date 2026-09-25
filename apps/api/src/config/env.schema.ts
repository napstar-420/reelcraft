import { z } from 'zod';

/** §23 — fail fast on a missing or malformed variable; no `process.env`
 * reads anywhere else in the codebase. */
export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().default(3000),

    DATABASE_URL: z.string().url(),

    S3_ENDPOINT: z.string().url(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default('video-engine'),
    S3_ACCESS_KEY_ID: z.string(),
    S3_SECRET_ACCESS_KEY: z.string(),
    S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

    PRESIGN_TTL_SEC: z.coerce.number().default(900),

    INNGEST_BASE_URL: z.string().url(),
    INNGEST_EVENT_KEY: z.string(),
    INNGEST_SIGNING_KEY: z.string(),

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
