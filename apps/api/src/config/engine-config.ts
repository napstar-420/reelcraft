import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

/** §23 — typed accessors over validated env, so nothing in the app reads
 * `process.env` directly. */
@Injectable()
export class EngineConfig implements OnModuleInit {
  private readonly logger = new Logger(EngineConfig.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  onModuleInit(): void {
    const has = (key: keyof Env) => this.config.get(key, { infer: true }) !== undefined;
    this.logger.log(
      {
        version: this.version,
        nodeEnv: this.nodeEnv,
        logLevel: this.logLevel,
        apiPort: this.apiPort,
        s3Bucket: this.s3.bucket,
        hasOpenrouterKey: has('OPENROUTER_API_KEY'),
        hasFalKey: has('FAL_KEY'),
        hasElevenlabsKey: has('ELEVENLABS_API_KEY'),
        hasDeepgramKey: has('DEEPGRAM_API_KEY'),
        hasPublicApiBaseUrl: has('PUBLIC_API_BASE_URL'),
        hasRemotionBrowser: has('REMOTION_BROWSER_EXECUTABLE'),
        infraRetries: this.infraRetries,
        qcErrorRetries: this.qcErrorRetries,
        iterateMaxItems: this.iterateMaxItems,
        blobRetentionDays: this.blobRetentionDays,
      },
      'engine config loaded',
    );
  }

  get apiPort(): number {
    return this.config.get('API_PORT', { infer: true });
  }

  get version(): string {
    return this.config.get('REELCRAFT_VERSION', { infer: true }) ?? 'dev';
  }

  get webDistDir(): string | undefined {
    return this.config.get('WEB_DIST_DIR', { infer: true });
  }

  get nodeEnv(): Env['NODE_ENV'] {
    return this.config.get('NODE_ENV', { infer: true });
  }

  get logLevel(): NonNullable<Env['LOG_LEVEL']> {
    return (
      this.config.get('LOG_LEVEL', { infer: true }) ?? (this.nodeEnv === 'test' ? 'warn' : 'info')
    );
  }

  get databaseUrl(): string {
    return this.config.get('DATABASE_URL', { infer: true });
  }

  get s3(): {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  } {
    return {
      endpoint: this.config.get('S3_ENDPOINT', { infer: true }),
      region: this.config.get('S3_REGION', { infer: true }),
      bucket: this.config.get('S3_BUCKET', { infer: true }),
      accessKeyId: this.config.get('S3_ACCESS_KEY_ID', { infer: true }),
      secretAccessKey: this.config.get('S3_SECRET_ACCESS_KEY', { infer: true }),
      forcePathStyle: this.config.get('S3_FORCE_PATH_STYLE', { infer: true }),
    };
  }

  /** See `S3_BROWSER_PATH_PREFIX` in env.schema.ts. */
  get s3BrowserPathPrefix(): string | undefined {
    return this.config.get('S3_BROWSER_PATH_PREFIX', { infer: true });
  }

  get presignTtlSec(): number {
    return this.config.get('PRESIGN_TTL_SEC', { infer: true });
  }

  get publicApiBaseUrl(): string {
    return (
      this.config.get('PUBLIC_API_BASE_URL', { infer: true }) ?? `http://localhost:${this.apiPort}`
    );
  }

  get inngest(): { baseUrl: string; eventKey: string; signingKey: string } {
    return {
      baseUrl: this.config.get('INNGEST_BASE_URL', { infer: true }),
      eventKey: this.config.get('INNGEST_EVENT_KEY', { infer: true }),
      signingKey: this.config.get('INNGEST_SIGNING_KEY', { infer: true }),
    };
  }

  get workspaceRoot(): string {
    return this.config.get('WORKSPACE_ROOT', { infer: true });
  }

  get codexProfile(): string {
    return this.config.get('CODEX_PROFILE', { infer: true }) ?? 'reelcraft';
  }

  get codexImageExtension(): string {
    return this.config.get('CODEX_IMAGE_EXTENSION', { infer: true }) ?? 'imagegen';
  }

  get codexBrowserExtension(): string {
    return this.config.get('CODEX_BROWSER_EXTENSION', { infer: true }) ?? 'browseros-neo';
  }

  get codexBrowserOsUrl(): string {
    return this.config.get('CODEX_BROWSER_OS_URL', { infer: true }) ?? 'http://127.0.0.1:9010/mcp';
  }

  get codexReadinessTimeoutMs(): number {
    return this.config.get('CODEX_READINESS_TIMEOUT_MS', { infer: true }) ?? 2_000;
  }

  get codexJobTimeoutMs(): number {
    return this.config.get('CODEX_JOB_TIMEOUT_MS', { infer: true }) ?? 900_000;
  }

  get codexBrowserMaxSteps(): number {
    return this.config.get('CODEX_BROWSER_MAX_STEPS', { infer: true }) ?? 50;
  }

  get codexOutputMaxBytes(): number {
    return this.config.get('CODEX_OUTPUT_MAX_BYTES', { infer: true }) ?? 16 * 1024 * 1024;
  }

  get computeMinFreeBytes(): number {
    return this.config.get('COMPUTE_MIN_FREE_BYTES', { infer: true });
  }

  get computeJobRetentionSec(): number {
    return this.config.get('COMPUTE_JOB_RETENTION_SEC', { infer: true });
  }

  get remotionBrowserExecutable(): string | undefined {
    return this.config.get('REMOTION_BROWSER_EXECUTABLE', { infer: true });
  }

  get blobRetentionDays(): number {
    return this.config.get('BLOB_RETENTION_DAYS', { infer: true });
  }

  get iterateMaxItems(): number {
    return this.config.get('ITERATE_MAX_ITEMS', { infer: true });
  }

  get infraRetries(): number {
    return this.config.get('INFRA_RETRIES', { infer: true });
  }

  get qcErrorRetries(): number {
    return this.config.get('QC_ERROR_RETRIES', { infer: true });
  }

  get sandboxMemoryMb(): number {
    return this.config.get('SANDBOX_MEMORY_MB', { infer: true });
  }

  get sandboxTimeoutMs(): number {
    return this.config.get('SANDBOX_TIMEOUT_MS', { infer: true });
  }

  /** Secret used to authenticate stateless invalidation preview tokens.
   * Tests get an isolated fallback so unit fixtures do not need production
   * credentials; every other environment is rejected by `validateEnv` when
   * the secret is absent. */
  get previewTokenSecret(): string {
    const secret = this.config.get('PREVIEW_TOKEN_SECRET', { infer: true });
    if (secret !== undefined) return secret;
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') {
      return 'reelcraft-test-only-preview-token-secret';
    }
    throw new Error('PREVIEW_TOKEN_SECRET is required outside tests');
  }

  get previewTokenTtlSec(): number {
    return this.config.get('PREVIEW_TOKEN_TTL_SEC', { infer: true });
  }

  /** §11.4 — pre-submit reservation TTL: how long a reservation may sit
   * before `submit()` without being swept as an orphan. */
  get preSubmitTtlSec(): number {
    return this.config.get('PRE_SUBMIT_TTL_SEC', { infer: true });
  }

  /** §11.4 — added on top of `polling.maxWaitSec` at submit time, so the
   * sweep never races a legitimately-still-polling job. */
  get fetchAllowanceSec(): number {
    return this.config.get('FETCH_ALLOWANCE_SEC', { infer: true });
  }
}
