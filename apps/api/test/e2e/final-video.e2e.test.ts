import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ListRunsQueryDto, type StageDef } from '@reelcraft/shared';
import { ulid } from '../../src/common/ulid';
import {
  artifact,
  blob,
  blueprint,
  blueprintVersion,
  channel,
  run,
  stageExecution,
} from '../../src/db/schema/index';
import { RunService } from '../../src/run/run.service';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

function stage(key: string, capability = 'text.generate'): StageDef {
  return {
    key,
    label: key,
    capability,
    config: {},
    slots: {},
    context: {},
    output: { kind: capability === 'timeline.render' ? 'media.video' : 'text' },
    checks: [],
    retryLimit: 0,
  };
}

/**
 * A3 — `RunService.get()`'s `finalVideo` and `.list()`'s `posterBlobId` are
 * derived from `artifact`/`blob` rows directly, so this seeds them by hand
 * (same convention as `invalidation.e2e.test.ts`) rather than driving a
 * real ffmpeg-backed run end to end.
 */
describe('final video and poster (e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;

  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb);
  });

  afterAll(async () => {
    try {
      await testApp?.close();
    } finally {
      await testDb.teardown();
    }
  });

  async function seedRunWithVideo(options: { withPoster: boolean }) {
    const channelId = ulid();
    await testDb.db.insert(channel).values({ id: channelId, ownerId: 'local', name: 'Channel' });
    const blueprintId = ulid();
    await testDb.db.insert(blueprint).values({ id: blueprintId, channelId, name: 'Blueprint' });
    const versionId = ulid();
    const graph = [stage('script'), stage('assemble', 'timeline.render')];
    await testDb.db.insert(blueprintVersion).values({
      id: versionId,
      blueprintId,
      version: 1,
      graph,
      defaults: {},
      budget: { runCapUsd: 10 },
      validation: [],
      runnable: true,
    });

    const runId = ulid();
    await testDb.db.insert(run).values({
      id: runId,
      channelId,
      blueprintVersionId: versionId,
      state: 'COMPLETED',
      inputs: {},
      resolvedConfig: {},
      budgetCapUsd: '10.0000',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    });

    const scriptArtifactId = ulid();
    const videoArtifactId = ulid();
    const videoBlobId = ulid();
    const posterBlobId = ulid();
    await testDb.db.insert(blob).values([
      {
        id: videoBlobId,
        ownerId: 'local',
        scope: 'run',
        runId,
        bucket: 'test',
        objectKey: `runs/${runId}/final.mp4`,
        mime: 'video/mp4',
        bytes: 1000,
        sha256: 'a'.repeat(64),
        probe: { container: 'mp4', durationSec: 42, streams: [] },
      },
      ...(options.withPoster
        ? [
            {
              id: posterBlobId,
              ownerId: 'local',
              scope: 'run' as const,
              runId,
              bucket: 'test',
              objectKey: `runs/${runId}/poster.png`,
              mime: 'image/png',
              bytes: 100,
              sha256: 'b'.repeat(64),
            },
          ]
        : []),
    ]);

    await testDb.db.insert(artifact).values([
      {
        id: scriptArtifactId,
        runId,
        producerStageKey: 'script',
        kind: 'text',
        data: { text: 'a script' },
        stale: false,
        reproLevel: 'exact',
      },
      {
        id: videoArtifactId,
        runId,
        producerStageKey: 'assemble',
        kind: 'media.video',
        blobId: videoBlobId,
        probe: { container: 'mp4', durationSec: 42, streams: [] },
        derived: options.withPoster ? { poster: posterBlobId } : null,
        stale: false,
        reproLevel: 'exact',
      },
    ]);

    await testDb.db.insert(stageExecution).values([
      {
        id: ulid(),
        runId,
        stageKey: 'script',
        state: 'passed',
        outputArtifactId: scriptArtifactId,
      },
      {
        id: ulid(),
        runId,
        stageKey: 'assemble',
        state: 'passed',
        outputArtifactId: videoArtifactId,
      },
    ]);

    return { runId, videoArtifactId, videoBlobId, posterBlobId };
  }

  it('get() resolves finalVideo to the last video-producing stage, with duration and poster', async () => {
    const runs = testApp.app.get(RunService);
    const { runId, videoArtifactId, videoBlobId, posterBlobId } = await seedRunWithVideo({
      withPoster: true,
    });

    const detail = await runs.get(runId);
    expect(detail.finalVideo).toEqual({
      artifactId: videoArtifactId,
      blobId: videoBlobId,
      durationSec: 42,
      posterBlobId,
    });
  });

  it('get() omits posterBlobId when no poster has been extracted yet', async () => {
    const runs = testApp.app.get(RunService);
    const { runId, videoArtifactId, videoBlobId } = await seedRunWithVideo({ withPoster: false });

    const detail = await runs.get(runId);
    expect(detail.finalVideo).toEqual({
      artifactId: videoArtifactId,
      blobId: videoBlobId,
      durationSec: 42,
    });
  });

  it('get() returns finalVideo: null when no stage produced a video', async () => {
    const runs = testApp.app.get(RunService);
    const channelId = ulid();
    await testDb.db.insert(channel).values({ id: channelId, ownerId: 'local', name: 'Channel' });
    const blueprintId = ulid();
    await testDb.db.insert(blueprint).values({ id: blueprintId, channelId, name: 'Blueprint' });
    const versionId = ulid();
    await testDb.db.insert(blueprintVersion).values({
      id: versionId,
      blueprintId,
      version: 1,
      graph: [stage('script')],
      defaults: {},
      budget: { runCapUsd: 10 },
      validation: [],
      runnable: true,
    });
    const runId = ulid();
    await testDb.db.insert(run).values({
      id: runId,
      channelId,
      blueprintVersionId: versionId,
      state: 'RUNNING',
      inputs: {},
      resolvedConfig: {},
      budgetCapUsd: '10.0000',
    });

    const detail = await runs.get(runId);
    expect(detail.finalVideo).toBeNull();
  });

  it('list() includes posterBlobId, and drops it once the artifact is staled', async () => {
    const runs = testApp.app.get(RunService);
    const { runId, videoArtifactId, posterBlobId } = await seedRunWithVideo({ withPoster: true });

    const before = await runs.list(ListRunsQueryDto.parse({ includeDryRuns: true }));
    expect(before.items.find((r) => r.id === runId)?.posterBlobId).toBe(posterBlobId);

    await testDb.db.update(artifact).set({ stale: true }).where(eq(artifact.id, videoArtifactId));

    const after = await runs.list(ListRunsQueryDto.parse({ includeDryRuns: true }));
    expect(after.items.find((r) => r.id === runId)?.posterBlobId).toBeNull();
  });
});
