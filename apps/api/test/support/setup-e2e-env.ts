import { applyTestEnvDefaults } from './env';

/**
 * Registered as vitest's `setupFiles` so env is in place before any e2e
 * spec's imports are evaluated — `ConfigModule`'s `NestConfigModule.forRoot`
 * runs its `validateEnv` check eagerly at class-decoration time (i.e. at
 * import time, not at `AppModule` instantiation), so calling
 * `applyTestEnvDefaults()` from inside a `beforeAll` is too late once
 * `app.module.ts` has already been imported transitively.
 */
applyTestEnvDefaults();
