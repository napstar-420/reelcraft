import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.schema';

function requiredEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgres://reelcraft:reelcraft@localhost:5432/reelcraft',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_ACCESS_KEY_ID: 'access',
    S3_SECRET_ACCESS_KEY: 'secret',
    INNGEST_BASE_URL: 'http://localhost:8288',
    INNGEST_EVENT_KEY: 'event',
    INNGEST_SIGNING_KEY: 'signing',
    PREVIEW_TOKEN_SECRET: 'preview-secret-at-least-32-characters',
    ...overrides,
  };
}

describe('preview-token environment configuration', () => {
  it('requires PREVIEW_TOKEN_SECRET outside tests', () => {
    const env = requiredEnv();
    delete env.PREVIEW_TOKEN_SECRET;

    expect(() => validateEnv(env)).toThrow('PREVIEW_TOKEN_SECRET');
  });

  it('permits the test environment to use its isolated fallback secret', () => {
    const env = requiredEnv({ NODE_ENV: 'test' });
    delete env.PREVIEW_TOKEN_SECRET;

    expect(validateEnv(env).PREVIEW_TOKEN_SECRET).toBeUndefined();
  });

  it('defaults PREVIEW_TOKEN_TTL_SEC to 600 and rejects non-positive values', () => {
    expect(validateEnv(requiredEnv()).PREVIEW_TOKEN_TTL_SEC).toBe(600);
    expect(() => validateEnv(requiredEnv({ PREVIEW_TOKEN_TTL_SEC: 0 }))).toThrow(
      'PREVIEW_TOKEN_TTL_SEC',
    );
  });
});
