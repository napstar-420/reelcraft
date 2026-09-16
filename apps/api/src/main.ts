import 'reflect-metadata';
import { json } from 'express';
import { NestFactory } from '@nestjs/core';
import { serve } from 'inngest/express';
import { AppModule } from './app.module';
import { EngineConfig } from './config/engine-config';
import { INNGEST_CLIENT } from './orchestration/inngest.client';
import { buildInngestFunctions } from './orchestration/functions/index';

/** §1.4/§13.1 — CORS stays off; Vite proxies /api in dev, Nest serves the
 * SPA in prod. MinIO is the deliberate second origin (§21.3). */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.use(json({ limit: '10mb' })); // memoized step state grows with the run

  app.setGlobalPrefix('api');

  const client = app.get(INNGEST_CLIENT);
  const functions = buildInngestFunctions(app);
  app.use('/api/inngest', serve({ client, functions }));

  const config = app.get(EngineConfig);
  await app.listen(config.apiPort);
}

bootstrap().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
