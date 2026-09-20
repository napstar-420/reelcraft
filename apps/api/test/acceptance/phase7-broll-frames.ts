import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Test } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
import type { Inngest } from 'inngest';
import type { StageDef } from '@reefcraft/shared';
import { AppModule } from '../../src/app.module';
import { DRIZZLE } from '../../src/db/drizzle.provider';
import { INNGEST_CLIENT } from '../../src/orchestration/inngest.client';
import { STORAGE_ADAPTER } from '../../src/storage/storage.adapter';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { ChannelService } from '../../src/channel/channel.service';
import { RunService } from '../../src/run/run.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { DerivedFrameService } from '../../src/artifact/derived-frame.service';
import { MediaProbeService } from '../../src/artifact/media-probe.service';
import { artifact, blob, run, stageAttempt } from '../../src/db/schema/index';
import { MemoryStorageAdapter } from '../support/memory-storage.adapter';
import { createTestDb } from '../support/test-db';

/**
 * A trimmed, vitest-free stand-in for `test/support/build-app.ts`'s
 * `buildTestApp()`: same DI graph and the same `DRIZZLE`/`STORAGE_ADAPTER`
 * overrides, but `build-app.ts` imports `vi` from `vitest` for its
 * `inngest.send` stub, which only works inside a real Vitest worker — this
 * script is run by plain `node` (see `package.json`'s
 * `acceptance:phase7-broll`: `tsc` compiles it for real decorator-metadata
 * emission, since `tsx`/esbuild silently drops `emitDecoratorMetadata` and
 * NestJS's constructor-type DI needs it). `MediaProbeService` and
 * `DerivedFrameService` are deliberately NOT stubbed here — the whole point
 * of this script is exercising the real `ffprobe`/`ffmpeg` binaries.
 */
async function buildApp(testDb: Awaited<ReturnType<typeof createTestDb>>) {
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DRIZZLE)
    .useValue(testDb.db)
    .overrideProvider(STORAGE_ADAPTER)
    .useValue(new MemoryStorageAdapter())
    .overrideProvider(MediaProbeService)
    .useValue(new MediaProbeService())
    .overrideProvider(DerivedFrameService)
    .useClass(CountingDerivedFrameService);
  const app = await builder.compile();
  await app.init();
  const inngestClient = app.get<Inngest>(INNGEST_CLIENT);
  inngestClient.send = async () => ({ ids: [] });
  return app;
}

const exec = promisify(execFile);

/**
 * Phase 7 chunk 7 — the local, ffmpeg-dependent counterpart to
 * `phase7-broll.e2e.test.ts` (which stubs `DerivedFrameService.runFfmpeg` to
 * stay CI-safe). This script proves the real §14.4 derived-frame shortcut
 * against a real video file: `{from:'prevItem', path:'lastFrame'}` really
 * shells out to `ffmpeg`, really caches the result on the source artifact's
 * `derived` column, and really skips a second `ffmpeg` invocation on a
 * repeat resolution. Mirrors `phase6-render.ts`'s own local-acceptance
 * conventions (a real ffmpeg-built fixture, `StageRunnerService` driven
 * directly with no Inngest, `process.exitCode = 1` on any failure).
 */

/** Counts real `ffmpeg` invocations without disabling them — the real
 * `DerivedFrameService.runFfmpeg` still runs via `super.runFfmpeg()`. */
class CountingDerivedFrameService extends DerivedFrameService {
  ffmpegCalls = 0;
  protected override async runFfmpeg(args: string[]): Promise<void> {
    this.ffmpegCalls += 1;
    await super.runFfmpeg(args);
  }
}

function brollStage(fixturePath: string): StageDef {
  return {
    key: 'broll',
    label: 'B-roll',
    capability: 'video.generate',
    config: {},
    // `video.generate`'s real capability declares `startFrame` as
    // `required: false` (confirmed by reading
    // `media-generate.capability.ts`) — no `iterateFallback`-style escape
    // hatch is needed for item 0's `undefined` case (§14.4).
    slots: { startFrame: { from: 'prevItem', path: 'lastFrame' } },
    context: {},
    iterate: { over: { from: 'const', value: [0, 1, 2] }, itemAlias: 'idx', itemRetryLimit: 0 },
    // The fixture has no audio track; not the policy under test here.
    output: { kind: 'media.video', constraints: { audio: 'optional' } },
    checks: [],
    retryLimit: 0,
    model: {
      provider: 'fake',
      modelId: 'fake-video-1',
      params: { fakeOutput: { kind: 'media.video', localPath: fixturePath, mime: 'video/mp4' } },
    },
  };
}

async function main() {
  // Env (`DATABASE_URL`, `NODE_ENV=test`, etc.) is loaded by the `--require
  // ./test/acceptance/preload-env.cjs` flag `package.json`'s
  // `acceptance:phase7-broll` script passes to `node` — guaranteed to run
  // before this module (or `AppModule`, imported above) is ever loaded,
  // which a same-process `applyTestEnvDefaults()` call here could not
  // guarantee against a static `import { AppModule }`.
  const dir = await mkdtemp(path.join(tmpdir(), 'reefcraft-phase7-broll-frames-'));
  const clip = path.join(dir, 'fixture.mp4');
  await exec('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=0x2266aa:s=640x360:d=2:r=30',
    '-pix_fmt',
    'yuv420p',
    clip,
  ]);

  const testDb = await createTestDb();
  const app = await buildApp(testDb);

  try {
    const derivedFrameService = app.get(DerivedFrameService) as CountingDerivedFrameService;
    const channels = app.get(ChannelService);
    const blueprints = app.get(BlueprintService);
    const runs = app.get(RunService);
    const runner = app.get(StageRunnerService);

    const graph: StageDef[] = [brollStage(clip)];
    const channel = await channels.create('local', {
      name: `Phase 7 broll frames ${Date.now()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Phase 7 broll frames');
    const version = await blueprints.createVersion(blueprintId, {
      graph,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    const created = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 10,
    });
    await testDb.db.update(run).set({ state: 'RUNNING' }).where(eq(run.id, created.id));

    const brollExec = created.stageExecutions.find((e) => e.stageKey === 'broll');
    if (!brollExec) throw new Error('no stage_execution for "broll"');

    const { stage, effective, prevStageKey } = await runner.loadStageContext(created.id, 'broll');
    const resolved = await runner.resolveIterateCount(
      created.id,
      brollExec.id,
      stage,
      effective,
      prevStageKey,
    );
    if (!resolved.ok) throw new Error(`resolveIterateCount failed: ${resolved.reason}`);
    if (resolved.itemCount !== 3) throw new Error(`expected 3 items, got ${resolved.itemCount}`);
    await runner.ensureStageItems(brollExec.id, resolved.itemCount);

    async function runItem(itemIndex: number): Promise<void> {
      const item = await runner.itemState(brollExec!.id, itemIndex);
      const attemptCtx = await runner.beginAttempt({
        runId: created.id,
        stageExecutionId: brollExec!.id,
        stageKey: stage.key,
        itemIndex,
        stageItemId: item.id,
      });
      const submitted = await runner.reserveAndSubmit(stage, attemptCtx, prevStageKey, effective);
      if (submitted.outcome !== 'submitted') {
        throw new Error(`item ${itemIndex}: unexpected submit outcome "${submitted.outcome}"`);
      }
      const result = await runner.fetchAndFinalize(
        stage,
        attemptCtx,
        submitted.handle,
        prevStageKey,
        effective,
      );
      if (result.outcome !== 'success') {
        throw new Error(`item ${itemIndex}: unexpected fetch outcome "${result.outcome}"`);
      }
    }

    // --- item 0: no predecessor, startFrame must resolve to undefined ---
    await runItem(0);

    const [item0Row] = await testDb.db
      .select()
      .from(artifact)
      .where(
        and(
          eq(artifact.runId, created.id),
          eq(artifact.producerStageKey, 'broll'),
          eq(artifact.itemIndex, 0),
        ),
      );
    if (!item0Row) throw new Error('item 0 artifact not found');
    if (item0Row.derived) throw new Error('item 0 should have no derived frame before item 1 runs');

    const item0 = await runner.itemState(brollExec.id, 0);
    const [item0Attempt] = await testDb.db
      .select()
      .from(stageAttempt)
      .where(eq(stageAttempt.stageItemId, item0.id));
    const item0StartFrame = (
      item0Attempt?.resolvedInputs as Record<string, { artifactId?: string }> | null
    )?.['slots.startFrame'];
    if (item0StartFrame?.artifactId) {
      throw new Error(
        `item 0's startFrame should resolve to undefined (no artifactId) per §14.4, got artifactId ${item0StartFrame.artifactId}`,
      );
    }

    // --- item 1: consumes item 0's real, ffmpeg-extracted lastFrame ---
    await runItem(1);

    const [item0AfterItem1] = await testDb.db
      .select()
      .from(artifact)
      .where(eq(artifact.id, item0Row.id));
    const derived = item0AfterItem1?.derived as Record<string, string> | null;
    if (!derived?.lastFrame) {
      throw new Error('item 0 artifact.derived.lastFrame was not populated after item 1 ran');
    }
    const ffmpegCallsAfterItem1 = derivedFrameService.ffmpegCalls;
    if (ffmpegCallsAfterItem1 < 1)
      throw new Error('expected at least one real ffmpeg extraction by now');

    const [frameBlob] = await testDb.db.select().from(blob).where(eq(blob.id, derived.lastFrame));
    if (!frameBlob) throw new Error(`derived frame blob "${derived.lastFrame}" not found`);
    if (!frameBlob.objectKey) throw new Error('derived frame blob has no objectKey');
    // A lone extracted frame has no real "duration" for ffprobe to report
    // (confirmed empirically: `ffprobe` on a single-frame PNG returns no
    // `format.duration` field at all), so `MediaProbeService.probe()`
    // throws and `DerivedFrameService.extractAndStore` deliberately
    // degrades to a probe-less blob rather than failing the whole
    // extraction over it (its own doc comment already anticipates this).
    // Assert width/height only when a probe DID get stored — `sourceKey`
    // (checked above via `objectKey`) is the assertion that actually proves
    // a real file was extracted and persisted.
    const probe = frameBlob.probe as {
      streams?: Array<{ type?: string; width?: number; height?: number }>;
    } | null;
    const videoStream = probe?.streams?.find((s) => s.type === 'video');
    if (probe && (!videoStream?.width || !videoStream.height)) {
      throw new Error(
        `derived frame probe present but missing plausible width/height: ${JSON.stringify(probe)}`,
      );
    }
    console.log(
      probe
        ? `item 1's startFrame resolved to a real extracted frame: ${frameBlob.objectKey} (${videoStream!.width}x${videoStream!.height})`
        : `item 1's startFrame resolved to a real extracted frame: ${frameBlob.objectKey} (no duration for ffprobe to report on a lone still frame, width/height unavailable — expected)`,
    );

    const item1 = await runner.itemState(brollExec.id, 1);
    const [item1Attempt] = await testDb.db
      .select()
      .from(stageAttempt)
      .where(eq(stageAttempt.stageItemId, item1.id));
    const item1StartFrame = (
      item1Attempt?.resolvedInputs as Record<string, { artifactId?: string }> | null
    )?.['slots.startFrame'];
    if (item1StartFrame?.artifactId !== item0Row.id) {
      throw new Error(
        `item 1's startFrame provenance should reference item 0's artifact "${item0Row.id}", got ${JSON.stringify(item1StartFrame)}`,
      );
    }

    // --- item 2: drives a SECOND, unrelated extraction (item 1's own
    // lastFrame) so the cache assertion below has a real prior call count
    // to compare against, then we resolve item 1's lastFrame a SECOND time
    // by hand (simulating a later reader) and confirm no new ffmpeg call. ---
    await runItem(2);
    const ffmpegCallsAfterItem2 = derivedFrameService.ffmpegCalls;
    if (ffmpegCallsAfterItem2 <= ffmpegCallsAfterItem1) {
      throw new Error('expected item 2 to trigger its own (first) extraction of item 1s lastFrame');
    }

    const [item1Row] = await testDb.db
      .select()
      .from(artifact)
      .where(
        and(
          eq(artifact.runId, created.id),
          eq(artifact.producerStageKey, 'broll'),
          eq(artifact.itemIndex, 1),
        ),
      );
    if (!item1Row) throw new Error('item 1 artifact not found');

    const before = derivedFrameService.ffmpegCalls;
    const secondResolution = await derivedFrameService.extract(item1Row, 'lastFrame');
    if (derivedFrameService.ffmpegCalls !== before) {
      throw new Error(
        `second resolution of item 1's lastFrame re-invoked ffmpeg (calls went from ${before} to ${derivedFrameService.ffmpegCalls})`,
      );
    }
    if (!secondResolution.sourceKey) {
      throw new Error('second resolution of item 1s lastFrame returned no sourceKey');
    }

    console.log(
      `phase 7 broll-frames acceptance passed: ${derivedFrameService.ffmpegCalls} real ffmpeg extraction(s), ` +
        'repeat resolution confirmed cached (no extra ffmpeg call)',
    );
  } finally {
    await app.close();
    await testDb.teardown();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
