import { loadRootEnv } from '../../src/common/load-dotenv';

/** Syntactically-valid placeholders for vars that e2e tests don't exercise
 * for real (the DB connection is overridden with a scoped test client; no
 * suite yet talks to MinIO or a live Inngest server) — only fills gaps left
 * by a missing `.env`, e.g. in CI, so `ConfigModule`'s env validation can
 * still pass at test-app boot. */
const PLACEHOLDER_DEFAULTS: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://reelcraft:reelcraft@localhost:5432/reelcraft_test_placeholder',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY_ID: 'test',
  S3_SECRET_ACCESS_KEY: 'test',
  INNGEST_BASE_URL: 'http://localhost:8288',
  INNGEST_EVENT_KEY: 'test-event-key',
  INNGEST_SIGNING_KEY: '0'.repeat(64),
};

/** Loads the repo-root `.env` (real docker-compose values, when running
 * locally against `docker compose up`) then fills any still-missing
 * required var with a harmless placeholder. Never overwrites a value
 * that's already set. Call once, before building a test app. */
export function applyTestEnvDefaults(): void {
  loadRootEnv();
  for (const [key, value] of Object.entries(PLACEHOLDER_DEFAULTS)) {
    if (!process.env[key]) process.env[key] = value;
  }
}
