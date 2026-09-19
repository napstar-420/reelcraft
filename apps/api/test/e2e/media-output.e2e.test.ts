import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Probe, StageDef } from '@reefcraft/shared';
import { and, eq } from 'drizzle-orm';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { BlobService } from '../../src/artifact/blob.service';
import { artifact, blob, run as runTable, stageAttempt } from '../../src/db/schema';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

const IMAGE_PROBE: Probe = {
  container: 'png_pipe',
  durationSec: 0,
  streams: [{ type: 'video', codec: 'png', width: 1, height: 1, fps: 1 }],
};
const SILENT_VIDEO_PROBE: Probe = {
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  durationSec: 5,
  streams: [{ type: 'video', codec: 'h264', width: 1280, height: 720, fps: 24 }],
};

function graph(
  output: StageDef['output'],
  modelId: string,
  params: Record<string, unknown> = {},
): StageDef[] {
  return [
    {
      key: 'media',
      label: 'Media',
      capability: output.kind === 'media.image' ? 'image.generate' : 'video.generate',
      config: {},
      slots: {},
      context: {},
      output,
      checks: [],
      retryLimit: 0,
      model: { provider: 'fake', modelId, params },
    },
  ];
}

describe('fake media output (e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;
  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb, {
      mediaProbe: {
        probe: async (file) => (file.endsWith('.png') ? IMAGE_PROBE : SILENT_VIDEO_PROBE),
        hasAudio: (probe) => probe.streams.some((stream) => stream.type === 'audio'),
      },
    });
  });
  afterAll(async () => {
    try {
      await testApp?.close();
    } finally {
      await testDb.teardown();
    }
  });

  it('persists a fake image through the real runner and exposes a live blob URL', async () => {
    const result = await execute(graph({ kind: 'media.image' }, 'fake-image-1'));
    if (result.outcome !== 'success')
      throw new Error(`expected media success, got ${result.outcome}`);
    const [row] = await testDb.db
      .select()
      .from(artifact)
      .where(eq(artifact.id, result.artifactId))
      .limit(1);
    expect(row).toMatchObject({ kind: 'media.image', stale: false, probe: IMAGE_PROBE });
    const [stored] = await testDb.db.select().from(blob).where(eq(blob.id, row!.blobId!)).limit(1);
    expect(stored?.scope).toBe('run');
    const url = await testApp.app.get(BlobService).readUrl('local', stored!.id);
    expect(url).toMatchObject({ status: 'live', url: expect.stringMatching(/^memory:\/\//) });
    await testDb.db
      .update(blob)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(blob.id, stored!.id));
    expect(await testApp.app.get(BlobService).readUrl('local', stored!.id)).toMatchObject({
      status: 'gone',
      blob: { id: stored!.id },
    });
  });

  it('rejects a silent fake video when audio is required by default', async () => {
    const result = await execute(
      graph({ kind: 'media.video' }, 'fake-video-1', {
        fakeOutput: {
          kind: 'media.video',
          mime: 'video/mp4',
          filename: 'silent.mp4',
          base64: 'AA==',
        },
      }),
    );
    expect(result.outcome).toBe('check_failed');
    const [attempt] = await testDb.db
      .select()
      .from(stageAttempt)
      .where(eq(stageAttempt.id, result.attemptId))
      .limit(1);
    expect(attempt?.checkResults).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'audio_constraint', pass: false })]),
    );
  });

  async function execute(stageGraph: StageDef[]) {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);
    const runner = testApp.app.get(StageRunnerService);
    const channel = await channels.create('local', {
      name: `Media ${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Media blueprint');
    const version = await blueprints.createVersion(blueprintId, {
      graph: stageGraph,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    expect(version.runnable).toBe(true);
    const created = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 10,
    });
    await testDb.db.update(runTable).set({ state: 'RUNNING' }).where(eq(runTable.id, created.id));
    const execution = created.stageExecutions[0]!;
    const { stage, effective, prevStageKey } = await runner.loadStageContext(created.id, 'media');
    const attempt = await runner.beginAttempt({
      runId: created.id,
      stageExecutionId: execution.id,
      stageKey: 'media',
    });
    const submitted = await runner.reserveAndSubmit(stage, attempt, prevStageKey, effective);
    if (submitted.outcome !== 'submitted') throw new Error(`submission: ${submitted.outcome}`);
    const finished = await runner.fetchAndFinalize(
      stage,
      attempt,
      submitted.handle,
      prevStageKey,
      effective,
    );
    return { ...finished, attemptId: attempt.stageAttemptId };
  }
});
