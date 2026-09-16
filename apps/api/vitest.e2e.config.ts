import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * e2e specs boot the real AppModule against a scoped Postgres schema
 * (test/support/test-db.ts) — single-fork execution avoids concurrent
 * suites racing each other's schema create/drop, and the timeout is long
 * enough for a real migrate + multi-stage run through the fake provider.
 */
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.test.ts'],
    environment: 'node',
    setupFiles: ['./test/support/setup-e2e-env.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
});
