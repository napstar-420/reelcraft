import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import type { Inngest } from 'inngest';
import { AppModule } from '../../src/app.module';
import { DRIZZLE } from '../../src/db/drizzle.provider';
import { INNGEST_CLIENT } from '../../src/orchestration/inngest.client';
import { buildInngestFunctions } from '../../src/orchestration/functions/index';
import { applyTestEnvDefaults } from './env';
import type { TestDb } from './test-db';

export interface TestApp {
  app: INestApplicationContext;
  functions: ReturnType<typeof buildInngestFunctions>;
  close(): Promise<void>;
}

/**
 * Boots the real `AppModule` — the same DI graph as `main.ts`, all 14
 * modules, `CapabilityModule`'s DbModule-isolation included — against a
 * scoped test schema, then closes over it the same Inngest function
 * factory `main.ts` uses. `overrideProvider(DRIZZLE)` replaces the
 * Postgres-from-env factory in `DbModule`; every module that injects
 * `DRIZZLE` (it isn't `@Global()`, see db.module.ts) shares this one
 * override since Nest overrides by token across the whole container, not
 * per importing module.
 */
export async function buildTestApp(testDb: TestDb): Promise<TestApp> {
  applyTestEnvDefaults();

  const app = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DRIZZLE)
    .useValue(testDb.db)
    .compile();

  await app.init();

  // `RunService.create()` awaits `inngest.send('run/started', ...)` for
  // real. Locally that happens to succeed because docker-compose's `inngest`
  // dev server is listening on `INNGEST_BASE_URL` — but no suite actually
  // relies on Inngest receiving it (every function here is driven directly,
  // either via `functions` below through `InngestTestEngine`, or via direct
  // service calls; nothing depends on a live server dispatching back into
  // this process). In CI (Postgres only, no Inngest server) the real send
  // fails after several seconds of retries and throws, breaking every e2e
  // test that creates a run. Stub just `send` to a no-op — `createFunction`
  // (used by `buildInngestFunctions` right below) stays real.
  const inngestClient = app.get<Inngest>(INNGEST_CLIENT);
  vi.spyOn(inngestClient, 'send').mockResolvedValue({ ids: [] });

  const functions = buildInngestFunctions(app);

  return {
    app,
    functions,
    async close() {
      await app.close();
    },
  };
}
