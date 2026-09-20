import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import type { Inngest } from 'inngest';
import { AppModule } from '../../src/app.module';
import { DRIZZLE } from '../../src/db/drizzle.provider';
import { INNGEST_CLIENT } from '../../src/orchestration/inngest.client';
import { STORAGE_ADAPTER } from '../../src/storage/storage.adapter';
import { buildInngestFunctions } from '../../src/orchestration/functions/index';
import { applyTestEnvDefaults } from './env';
import { MemoryStorageAdapter } from './memory-storage.adapter';
import type { TestDb } from './test-db';
import { MediaProbeService } from '../../src/artifact/media-probe.service';
import { DerivedFrameService } from '../../src/artifact/derived-frame.service';

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
export async function buildTestApp(
  testDb: TestDb,
  options?: {
    mediaProbe?: Pick<MediaProbeService, 'probe' | 'hasAudio'>;
    /** Phase 7 chunk 7 — a suite exercising `{from:'prevItem', path:'lastFrame'}`
     * against a real `video.generate` stage needs a source artifact real
     * enough for `MediaArtifactService.persist` (satisfied by the default
     * fake `mediaProbe` above), but `DerivedFrameService.extract()` shells
     * out to a real `ffmpeg` binary on that same fake source — never CI-safe.
     * Passing a `DerivedFrameService` subclass here (overriding its
     * `protected runFfmpeg()`, same pattern as `derived-frame.e2e.test.ts`)
     * lets a suite exercise the real cache/lock/provenance plumbing without
     * a host ffmpeg install. Omit it (as every other suite does) to keep the
     * real service — e.g. the ffmpeg-dependent acceptance script. */
    derivedFrame?: new (
      ...args: ConstructorParameters<typeof DerivedFrameService>
    ) => DerivedFrameService;
  },
): Promise<TestApp> {
  applyTestEnvDefaults();

  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DRIZZLE)
    .useValue(testDb.db)
    // `BlobService.writeRawResponse` (called unconditionally by
    // `StageRunnerService.fetchAndFinalize`, on every attempt including
    // failing ones) goes through the real `S3StorageAdapter` otherwise —
    // another "works locally by accident" gap, since that only succeeds
    // because docker-compose's MinIO happens to be running locally. CI has
    // no MinIO service (only Postgres), so every e2e test that reaches
    // `fetchAndFinalize` would otherwise fail with ECONNREFUSED.
    .overrideProvider(STORAGE_ADAPTER)
    .useValue(new MemoryStorageAdapter());
  // E2E storage fixtures deliberately use tiny arbitrary buffers; keep the
  // engine-level suites independent of a host FFmpeg installation. Dedicated
  // media-output coverage passes an explicit deterministic probe.
  builder.overrideProvider(MediaProbeService).useValue(options?.mediaProbe ?? testMediaProbe());
  if (options?.derivedFrame) {
    builder.overrideProvider(DerivedFrameService).useClass(options.derivedFrame);
  }
  const app = await builder.compile();

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

function testMediaProbe(): Pick<MediaProbeService, 'probe' | 'hasAudio'> {
  return {
    async probe(file: string) {
      const audio = /\.(mp3|wav|m4a|aac)$/i.test(file);
      return {
        container: audio ? 'wav' : 'png_pipe',
        durationSec: audio ? 1 : 0,
        streams: [
          audio
            ? { type: 'audio' as const, codec: 'pcm_s16le', sampleRate: 8000 }
            : { type: 'video' as const, codec: 'png', width: 1, height: 1, fps: 1 },
        ],
      };
    },
    hasAudio(probe) {
      return probe.streams.some((stream) => stream.type === 'audio');
    },
  };
}
