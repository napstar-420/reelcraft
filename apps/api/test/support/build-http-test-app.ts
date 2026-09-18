import type { INestApplication } from '@nestjs/common';
import { json } from 'express';
import type { Inngest } from 'inngest';
import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { AppModule } from '../../src/app.module';
import { DRIZZLE } from '../../src/db/drizzle.provider';
import { INNGEST_CLIENT } from '../../src/orchestration/inngest.client';
import { STORAGE_ADAPTER } from '../../src/storage/storage.adapter';
import { applyTestEnvDefaults } from './env';
import { MemoryStorageAdapter } from './memory-storage.adapter';
import type { TestDb } from './test-db';

export interface HttpTestApp {
  app: INestApplication;
  baseUrl: string;
  close(): Promise<void>;
}

/** A real HTTP surface for action/race tests. Each call creates an isolated
 * Nest container, so concurrent callers share only the disposable Postgres
 * database (not services, locks, or in-process event state). */
export async function buildHttpTestApp(testDb: TestDb): Promise<HttpTestApp> {
  applyTestEnvDefaults();
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DRIZZLE)
    .useValue(testDb.db)
    .overrideProvider(STORAGE_ADAPTER)
    .useValue(new MemoryStorageAdapter())
    .compile();
  const app = module.createNestApplication();
  app.use(json({ limit: '10mb' }));
  app.setGlobalPrefix('api');
  const inngest = app.get<Inngest>(INNGEST_CLIENT);
  vi.spyOn(inngest, 'send').mockResolvedValue({ ids: [] });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  if (!address || typeof address === 'string')
    throw new Error('HTTP test server did not bind a port');
  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}/api`,
    close: () => app.close(),
  };
}
