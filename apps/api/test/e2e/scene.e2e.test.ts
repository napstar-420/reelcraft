import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { SceneSource, type StageDef } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { AssetService } from '../../src/channel/asset.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { BlenderRuntime } from '../../src/blender/blender-runtime.service';
import { STORAGE_ADAPTER, type StorageAdapter } from '../../src/storage/storage.adapter';
import { artifact, run as runTable } from '../../src/db/schema';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

const write: StageDef = {
  key: 'shot',
  label: 'Shot',
  capability: 'code.scene',
  config: { durationSec: 3, aspectRatio: '9:16' },
  slots: { assets: { from: 'library', kinds: ['model'], builtin: false } },
  context: {},
  checks: [],
  retryLimit: 0,
  instructions: { template: 'The robot waves hello.' },
  output: { kind: 'data', schema: { type: 'object' } },
  model: { provider: 'fake', modelId: 'fake-code-1' },
};

const render: StageDef = {
  key: 'render',
  label: 'Render',
  capability: 'scene.render',
  config: { quality: 'draft' },
  slots: { scene: { from: 'prev' } },
  context: {},
  checks: [],
  retryLimit: 0,
  output: { kind: 'media.video' },
};

describe('a scene written by a model, from the library (e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;
  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb);
    // CI has no Blender; the scene is written, not rendered, here.
    vi.spyOn(testApp.app.get(BlenderRuntime), 'binary').mockResolvedValue('/opt/blender/blender');
  });
  afterAll(async () => {
    try {
      await testApp?.close();
    } finally {
      await testDb.teardown();
    }
  });

  it('turns the model answer into a scene that loads the uploaded model by name', async () => {
    const channel = await testApp.app
      .get(ChannelService)
      .create('local', { name: `Scenes ${Date.now()}`, theme: {}, defaults: {} });
    const assets = testApp.app.get(AssetService);
    const storage = testApp.app.get<StorageAdapter>(STORAGE_ADAPTER);
    const upload = await assets.requestUpload(channel.id, 'glb');
    const glb = Buffer.alloc(12);
    glb.write('glTF', 0, 'latin1');
    await storage.put(upload.objectKey, glb, { mime: 'model/gltf-binary' });
    const robot = await assets.create(channel.id, {
      name: 'Robot',
      kind: 'model',
      blobId: upload.blobId,
      objectKey: upload.objectKey,
      sha256: 'robot',
      tags: [],
    });

    const blueprints = testApp.app.get(BlueprintService);
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Scenes');
    const version = await blueprints.createVersion(blueprintId, {
      graph: [write, render],
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 1 },
    });
    expect(
      (version.validation as Array<{ severity: string }>).filter((i) => i.severity === 'error'),
    ).toEqual([]);

    const runs = testApp.app.get(RunService);
    const runner = testApp.app.get(StageRunnerService);
    const created = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 1,
    });
    await runs.start(created.id).catch(() => undefined);
    await testDb.db.update(runTable).set({ state: 'RUNNING' }).where(eq(runTable.id, created.id));
    const execution = created.stageExecutions.find((e) => e.stageKey === 'shot')!;
    const loaded = await runner.loadStageContext(created.id, 'shot');
    const attempt = await runner.beginAttempt({
      runId: created.id,
      stageExecutionId: execution.id,
      stageKey: 'shot',
    });
    const submitted = await runner.reserveAndSubmit(
      loaded.stage,
      attempt,
      loaded.prevStageKey,
      loaded.effective,
    );
    if (submitted.outcome !== 'submitted') throw new Error(submitted.outcome);
    const finished = await runner.fetchAndFinalize(
      loaded.stage,
      attempt,
      submitted.handle,
      loaded.prevStageKey,
      loaded.effective,
    );
    expect(finished.outcome).toBe('success');
    const [row] = await testDb.db
      .select()
      .from(artifact)
      .where(eq(artifact.id, (finished as { artifactId: string }).artifactId));
    const scene = SceneSource.parse(row!.data);
    expect(scene).toMatchObject({
      engine: 'blender',
      width: 1080,
      height: 1920,
      fps: 24,
      durationSec: 3,
      transparent: false,
      assets: [{ name: 'Robot', kind: 'model', handle: `asset:${robot.id}` }],
    });
    expect(scene.script).toContain('def build(rc):');
  });
});
