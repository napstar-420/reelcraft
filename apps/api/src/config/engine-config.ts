import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

/** §23 — typed accessors over validated env, so nothing in the app reads
 * `process.env` directly. */
@Injectable()
export class EngineConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get apiPort(): number {
    return this.config.get('API_PORT', { infer: true });
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

  get presignTtlSec(): number {
    return this.config.get('PRESIGN_TTL_SEC', { infer: true });
  }

  get publicApiBaseUrl(): string {
    return this.config.get('PUBLIC_API_BASE_URL', { infer: true }) ?? `http://localhost:${this.apiPort}`;
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
      return 'reefcraft-test-only-preview-token-secret';
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
