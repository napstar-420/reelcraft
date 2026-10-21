import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Probe, StageDef } from '@reelcraft/shared';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { ChannelService } from '../../src/channel/channel.service';
import { RunService } from '../../src/run/run.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { ComputeJobService } from '../../src/storage/compute-job.service';
import { artifact, run as runTable } from '../../src/db/schema';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

const IMAGE_PROBE: Probe = {
  container: 'png',
  durationSec: 0,
  streams: [{ type: 'video', codec: 'png', width: 1, height: 1 }],
};
/** A 1x1 see-through PNG, standing in for the cut-out the render worker writes. */
const CLEAR_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const base: Pick<StageDef, 'config' | 'slots' | 'context' | 'checks' | 'retryLimit'> = {
  config: {},
  slots: {},
  context: {},
  checks: [],
  retryLimit: 0,
};

describe('cut out background: a generated picture made see-through (e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;
  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb, {
      mediaProbe: { probe: async () => IMAGE_PROBE, hasAudio: () => false },
    });
    // The cut-out needs ffmpeg, which CI doesn't have: the job hands back a ready PNG.
    const cutout = path.join(await mkdtemp(path.join(os.tmpdir(), 'cutout-e2e-')), 'cutout.png');
    await writeFile(cutout, CLEAR_PNG);
    const compute = testApp.app.get(ComputeJobService);
    vi.spyOn(compute, 'spawn').mockResolvedValue({ jobId: 'cutout-job', pid: 1 } as never);
    vi.spyOn(compute, 'collect').mockResolvedValue(cutout);
    vi.spyOn(compute, 'cleanup').mockResolvedValue(undefined);
  });
  afterAll(async () => {
    try {
      await testApp?.close();
    } finally {
      await testDb.teardown();
    }
  });

  it('cuts out the picture an image stage made, as a PNG image artifact', async () => {
    const graph: StageDef[] = [
      {
        ...base,
        key: 'picture',
        label: 'Draw the character',
        capability: 'image.generate',
        instructions: { template: 'A cartoon caveman on a plain flat green background.' },
        output: { kind: 'media.image' },
        model: { provider: 'fake', modelId: 'fake-image-1' },
      },
      {
        ...base,
        key: 'cutout',
        label: 'Cut out the character',
        capability: 'image.cutout',
        config: { tolerance: 0.2 },
        slots: { image: { from: 'prev' } },
        output: { kind: 'media.image' },
      },
    ];
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);
    const runner = testApp.app.get(StageRunnerService);
    const channel = await channels.create('local', {
      name: `Cutout ${Date.now()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Cutout blueprint');
    const version = await blueprints.createVersion(blueprintId, {
      graph,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    expect(
      (version.validation as Array<{ severity: string; message: string }>)
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.message),
    ).toEqual([]);
    const created = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });
    await runs.start(created.id).catch(() => undefined);
    await testDb.db.update(runTable).set({ state: 'RUNNING' }).where(eq(runTable.id, created.id));
    const artifacts: Record<string, string> = {};
    for (const stage of graph) {
      const execution = created.stageExecutions.find((e) => e.stageKey === stage.key)!;
      const loaded = await runner.loadStageContext(created.id, stage.key);
      const attempt = await runner.beginAttempt({
        runId: created.id,
        stageExecutionId: execution.id,
        stageKey: stage.key,
      });
      const submitted = await runner.reserveAndSubmit(
        loaded.stage,
        attempt,
        loaded.prevStageKey,
        loaded.effective,
      );
      expect(submitted.outcome, stage.key).toBe('submitted');
      if (submitted.outcome !== 'submitted') return;
      const finished = await runner.fetchAndFinalize(
        loaded.stage,
        attempt,
        submitted.handle,
        loaded.prevStageKey,
        loaded.effective,
      );
      expect(finished.outcome, JSON.stringify(finished)).toBe('success');
      if (finished.outcome === 'success') artifacts[stage.key] = finished.artifactId;
    }

    const read = async (id: string) =>
      (await testDb.db.select().from(artifact).where(eq(artifact.id, id)).limit(1))[0]!;
    const picture = await read(artifacts.picture!);
    const cutout = await read(artifacts.cutout!);
    expect(cutout.kind).toBe('media.image');
    expect(cutout.blobId).toBeTruthy();
    expect(cutout.blobId).not.toBe(picture.blobId);
    expect(Number(cutout.costUsd)).toBe(0);

    // The worker was given the generated picture, with the stage's tolerance.
    const compute = testApp.app.get(ComputeJobService);
    const spec = vi.mocked(compute.spawn).mock.calls.at(-1)![1];
    expect(spec.args.slice(1, 2)).toEqual(['cutout']);
    expect(spec.args.slice(-2)).toEqual(['0.2', '1']);
    expect(spec.inputs).toHaveLength(1);
    expect(spec.inputs[0]).toMatchObject({ asFilename: 'picture.png' });
    expect(spec.inputs[0]!.sourceKey).toBeTruthy();
  });
});
