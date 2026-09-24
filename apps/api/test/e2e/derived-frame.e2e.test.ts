import os from 'node:os';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import type { Env } from '../../src/config/env.schema';
import { EngineConfig } from '../../src/config/engine-config';
import { WorkspaceService } from '../../src/storage/workspace.service';
import type { MediaProbeService } from '../../src/artifact/media-probe.service';
import { DerivedFrameService } from '../../src/artifact/derived-frame.service';
import { ulid } from '../../src/common/ulid';
import {
  artifact,
  blob,
  blueprint,
  blueprintVersion,
  channel,
  run,
} from '../../src/db/schema/index';
import { createTestDb, type TestDb } from '../support/test-db';
import { MemoryStorageAdapter } from '../support/memory-storage.adapter';

function fakeEngineConfig(workspaceRoot: string): EngineConfig {
  const env: Env = {
    NODE_ENV: 'test',
    API_PORT: 3000,
    DATABASE_URL: 'postgres://x',
    S3_ENDPOINT: 'http://x',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'x',
    S3_ACCESS_KEY_ID: 'x',
    S3_SECRET_ACCESS_KEY: 'x',
    S3_FORCE_PATH_STYLE: true,
    PRESIGN_TTL_SEC: 900,
    INNGEST_BASE_URL: 'http://x',
    INNGEST_EVENT_KEY: 'x',
    INNGEST_SIGNING_KEY: 'x',
    WORKSPACE_ROOT: workspaceRoot,
    COMPUTE_MIN_FREE_BYTES: 0,
    COMPUTE_JOB_RETENTION_SEC: 86_400,
    BLOB_RETENTION_DAYS: 30,
    ITERATE_MAX_ITEMS: 50,
    PRE_SUBMIT_TTL_SEC: 600,
    FETCH_ALLOWANCE_SEC: 120,
    QC_ERROR_RETRIES: 2,
    INFRA_RETRIES: 2,
    SANDBOX_MEMORY_MB: 32,
    SANDBOX_TIMEOUT_MS: 100,
    PREVIEW_TOKEN_TTL_SEC: 600,
  };
  return new EngineConfig(new ConfigService<Env, true>(env));
}

/** Never shells out to ffprobe — a fake PNG buffer written by the stubbed
 * `runFfmpeg` below isn't a real image, so a real probe would just fail
 * anyway; `DerivedFrameService.extract()` already tolerates a probe failure
 * (degrades to no width/height), so this fake keeps the suite deterministic
 * instead of relying on that fallback. */
const fakeProbes: MediaProbeService = {
  probe: async () => ({
    container: 'image2',
    durationSec: 0,
    streams: [{ type: 'video', codec: 'png', width: 64, height: 48 }],
  }),
  hasAudio: () => false,
} as MediaProbeService;

/** Overrides the actual ffmpeg invocation so this suite never shells out to
 * a real binary — writes a small deterministic buffer to the expected
 * output path instead, and counts calls so tests can assert the cache
 * (top-level and under-lock) skips it entirely. */
class TestableDerivedFrameService extends DerivedFrameService {
  ffmpegCalls = 0;
  protected override async runFfmpeg(args: string[]): Promise<void> {
    this.ffmpegCalls += 1;
    const dest = args[args.length - 1]!;
    await writeFile(dest, Buffer.from('fake-png-bytes'));
  }
}

describe('DerivedFrameService (e2e, ffmpeg stubbed)', () => {
  let testDb: TestDb;
  let storage: MemoryStorageAdapter;
  let service: TestableDerivedFrameService;
  let runId: string;
  let channelId: string;

  async function seedSourceArtifact(): Promise<typeof artifact.$inferSelect> {
    const sourceKey = `source/${ulid()}.mp4`;
    await storage.put(sourceKey, Buffer.from('fake source video bytes'), { mime: 'video/mp4' });
    const sourceBlobId = ulid();
    await testDb.db.insert(blob).values({
      id: sourceBlobId,
      scope: 'run',
      runId,
      bucket: '',
      objectKey: sourceKey,
      mime: 'video/mp4',
      bytes: 24,
      sha256: 'deadbeef',
    });
    const artifactId = ulid();
    await testDb.db.insert(artifact).values({
      id: artifactId,
      runId,
      producerStageKey: `broll#${artifactId}`,
      itemIndex: 0,
      kind: 'media.video',
      blobId: sourceBlobId,
      stale: false,
      reproLevel: 'exact',
      costUsd: '0.0000',
    });
    const [row] = await testDb.db.select().from(artifact).where(eq(artifact.id, artifactId));
    return row!;
  }

  beforeAll(async () => {
    testDb = await createTestDb();
    storage = new MemoryStorageAdapter();
    const workspaceRoot = path.join(os.tmpdir(), `reelcraft-derived-frame-test-${ulid()}`);
    const workspaces = new WorkspaceService(fakeEngineConfig(workspaceRoot), storage);
    service = new TestableDerivedFrameService(testDb.db, workspaces, storage, fakeProbes);

    channelId = ulid();
    await testDb.db
      .insert(channel)
      .values({ id: channelId, ownerId: 'local', name: 'Test Channel' });
    const blueprintId = ulid();
    await testDb.db
      .insert(blueprint)
      .values({ id: blueprintId, channelId, name: 'Test Blueprint' });
    const versionId = ulid();
    await testDb.db.insert(blueprintVersion).values({
      id: versionId,
      blueprintId,
      version: 1,
      graph: [],
      defaults: {},
      budget: { runCapUsd: 10 },
      validation: [],
      runnable: true,
    });
    runId = ulid();
    await testDb.db.insert(run).values({
      id: runId,
      channelId,
      blueprintVersionId: versionId,
      state: 'RUNNING',
      inputs: {},
      resolvedConfig: {},
      budgetCapUsd: '10.0000',
    });
  });

  afterAll(async () => {
    await testDb.teardown();
  });

  it('first access with no cached derived entry extracts and persists a blob id into artifact.derived', async () => {
    const row = await seedSourceArtifact();
    const callsBefore = service.ffmpegCalls;

    const manifest = await service.extract(row, 'lastFrame');

    expect(service.ffmpegCalls).toBe(callsBefore + 1);
    expect(manifest).toMatchObject({ kind: 'media.image', sourceKey: expect.any(String) });

    const [updated] = await testDb.db.select().from(artifact).where(eq(artifact.id, row.id));
    const derived = updated!.derived as Record<string, string> | null;
    expect(derived?.lastFrame).toEqual(expect.any(String));

    const [blobRow] = await testDb.db.select().from(blob).where(eq(blob.id, derived!.lastFrame!));
    expect(blobRow?.mime).toBe('image/png');
  });

  it('second access with a cached entry returns the cached manifest WITHOUT invoking ffmpeg again', async () => {
    const row = await seedSourceArtifact();
    const first = await service.extract(row, 'lastFrame');
    const callsAfterFirst = service.ffmpegCalls;

    // Re-fetch the row so `.derived` reflects what the first call persisted —
    // this exercises the top-level fast path (no transaction at all).
    const [refreshed] = await testDb.db.select().from(artifact).where(eq(artifact.id, row.id));
    const second = await service.extract(refreshed!, 'lastFrame');

    expect(service.ffmpegCalls).toBe(callsAfterFirst);
    expect(second).toEqual(first);
  });

  it('a jsonb-merged derived write does not clobber an independently cached frame of the other kind', async () => {
    const row = await seedSourceArtifact();
    await service.extract(row, 'lastFrame');
    const callsAfterLast = service.ffmpegCalls;

    // `row` is the ORIGINAL stale snapshot (derived: null) — the top-level
    // fast path misses, forcing the transaction/lock path, which must see
    // lastFrame already there and still go on to extract firstFrame fresh.
    await service.extract(row, 'firstFrame');
    expect(service.ffmpegCalls).toBe(callsAfterLast + 1);

    const [updated] = await testDb.db.select().from(artifact).where(eq(artifact.id, row.id));
    const derived = updated!.derived as Record<string, string> | null;
    expect(derived?.lastFrame).toEqual(expect.any(String));
    expect(derived?.firstFrame).toEqual(expect.any(String));
    expect(derived?.firstFrame).not.toBe(derived?.lastFrame);
  });

  it('a race resolved by another caller first is picked up under the row lock — no second ffmpeg call', async () => {
    const row = await seedSourceArtifact();
    // Simulate a concurrent caller that already finished the extraction and
    // committed before this call ever takes the row lock: insert the "won"
    // blob directly, and point `artifact.derived` at it, entirely outside
    // `service`.
    const wonBlobId = ulid();
    await testDb.db.insert(blob).values({
      id: wonBlobId,
      scope: 'run',
      runId,
      bucket: '',
      objectKey: `derived/${wonBlobId}.png`,
      mime: 'image/png',
      bytes: 10,
      sha256: 'cafef00d',
    });
    await testDb.db
      .update(artifact)
      .set({ derived: { lastFrame: wonBlobId } })
      .where(eq(artifact.id, row.id));

    const callsBefore = service.ffmpegCalls;
    // `row` is still the pre-race snapshot (derived: null) — the top-level
    // fast path misses, so this must reach the `SELECT ... FOR UPDATE`
    // re-check, see the winner's value, and return it without extracting.
    const manifest = await service.extract(row, 'lastFrame');

    expect(service.ffmpegCalls).toBe(callsBefore);
    expect(manifest.sourceKey).toBe(`derived/${wonBlobId}.png`);
  });
});
