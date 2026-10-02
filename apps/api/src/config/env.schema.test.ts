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

describe('self-hosted environment configuration', () => {
  it('leaves single-port mode off by default', () => {
    const env = validateEnv(requiredEnv());

    expect(env.WEB_DIST_DIR).toBeUndefined();
    expect(env.S3_BROWSER_PATH_PREFIX).toBeUndefined();
  });

  it('accepts a path-shaped S3_BROWSER_PATH_PREFIX', () => {
    expect(
      validateEnv(requiredEnv({ S3_BROWSER_PATH_PREFIX: '/storage' })).S3_BROWSER_PATH_PREFIX,
    ).toBe('/storage');
    expect(
      validateEnv(requiredEnv({ S3_BROWSER_PATH_PREFIX: '/media/s3' })).S3_BROWSER_PATH_PREFIX,
    ).toBe('/media/s3');
  });

  it.each(['storage', '/storage/', 'http://localhost/storage', '/', '//evil'])(
    'rejects S3_BROWSER_PATH_PREFIX=%s',
    (value) => {
      expect(() => validateEnv(requiredEnv({ S3_BROWSER_PATH_PREFIX: value }))).toThrow(
        'S3_BROWSER_PATH_PREFIX',
      );
    },
  );
});

describe('INNGEST_SYNC_ON_BOOT', () => {
  it('accepts only true or false', () => {
    expect(validateEnv(requiredEnv({ INNGEST_SYNC_ON_BOOT: 'true' })).INNGEST_SYNC_ON_BOOT).toBe(
      'true',
    );
    expect(validateEnv(requiredEnv()).INNGEST_SYNC_ON_BOOT).toBeUndefined();
    expect(() => validateEnv(requiredEnv({ INNGEST_SYNC_ON_BOOT: 'yes' }))).toThrow(
      'INNGEST_SYNC_ON_BOOT',
    );
  });
});
