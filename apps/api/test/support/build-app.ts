import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { DRIZZLE } from '../../src/db/drizzle.provider';
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

  const functions = buildInngestFunctions(app);

  return {
    app,
    functions,
    async close() {
      await app.close();
    },
  };
}
