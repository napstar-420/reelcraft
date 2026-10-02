import 'reflect-metadata';
import { loadRootEnv } from './common/load-dotenv';

// Must run before `./app.module` is imported: ConfigModule.forRoot's
// `validate` executes eagerly at decorator-evaluation time, so process.env
// needs the root .env loaded before that import line is reached.
loadRootEnv();

import { json, type Express } from 'express';
import { pino } from 'pino';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { withQuietFrameworkBoot } from './common/logging.module';
import { serve } from 'inngest/express';
import { AppModule } from './app.module';
import { EngineConfig } from './config/engine-config';
import { INNGEST_CLIENT } from './orchestration/inngest.client';
import { buildInngestFunctions } from './orchestration/functions/index';
import { mountStorageProxy, mountWebApp } from './system/http-mounts';
import { syncInngestOnBoot } from './system/inngest-boot-sync';
import { ReadinessService } from './system/readiness.service';

/** §1.4/§13.1 — CORS stays off; Vite proxies /api in dev, Nest serves the
 * SPA in prod. MinIO is the deliberate second origin (§21.3) in dev; the
 * self-hosted image proxies it under one origin instead (`/storage`). */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(withQuietFrameworkBoot(app.get(Logger)));
  const config = app.get(EngineConfig);
  const http = app.getHttpAdapter().getInstance() as Express;

  mountStorageProxy(http, config); // before any body parser
  app.use(json({ limit: '10mb' })); // memoized step state grows with the run

  app.setGlobalPrefix('api');

  const client = app.get(INNGEST_CLIENT);
  const functions = buildInngestFunctions(app);
  // Inngest's serve endpoint is chatty at info (every step call).
  app.use('/api/inngest', serve({ client, functions, logLevel: 'warn' }));
  mountWebApp(http, config);

  await app.listen(config.apiPort);

  if (config.inngestSyncOnBoot) {
    const readiness = app.get(ReadinessService);
    void syncInngestOnBoot({
      url: `http://127.0.0.1:${config.apiPort}/api/inngest`,
      logger: app.get(Logger),
    }).then(() => readiness.markInngestSynced());
  }
}

bootstrap().catch((err: unknown) => {
  // The Nest logger may not exist yet; a bare pino line keeps the output JSON.
  pino().fatal({ err }, 'API failed to start');
  process.exit(1);
});
