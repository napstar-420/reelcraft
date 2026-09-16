import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StageDef } from '@reefcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { artifact } from '../../src/db/schema/index';
import { eq } from 'drizzle-orm';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

const DATA_STAGE_GRAPH: StageDef[] = [
  {
    key: 'outline',
    label: 'Outline',
    capability: 'llm.generate',
    config: {},
    slots: {},
    context: {},
    output: {
      kind: 'data',
      schema: {
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
      },
    },
    checks: [],
    retryLimit: 0,
    model: {
      provider: 'fake',
      modelId: 'fake-text-1',
      params: { max_tokens: 256, fakeOutput: { title: 'Coral Reefs' } },
    },
  },
];

/**
 * `StageRunnerService.fetchAndFinalize`'s `data` branch (`stage-runner.service.ts`)
 * has existed since phase 1 but was never exercised end-to-end with a real
 * structured payload — the fake provider could only ever echo a string.
 * Chunk 4's `params.fakeOutput` passthrough closes that gap; this proves
 * the whole save -> run -> finalize -> schema_hash path works for real,
 * de-risking chunk 5's data-output acceptance-test stage.
 */
describe('data-output artifact (e2e)', () => {
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

  it('runs a data-output stage through the fake provider and records a real object + schema_hash', async () => {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);
    const stageRunner = testApp.app.get(StageRunnerService);

    const channel = await channels.create('local', {
      name: 'Data Output Channel',
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Data Output Blueprint');
    const version = await blueprints.createVersion(blueprintId, {
      graph: DATA_STAGE_GRAPH,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    expect(version.runnable).toBe(true);

    const run = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 10,
    });

    const stageExecution = run.stageExecutions.find((e) => e.stageKey === 'outline');
    if (!stageExecution) throw new Error('stage execution not found');

    const { stage, effective, prevStageKey } = await stageRunner.loadStageContext(
      run.id,
      'outline',
    );
    const attemptCtx = await stageRunner.beginAttempt({
      runId: run.id,
      stageExecutionId: stageExecution.id,
      stageKey: 'outline',
      attemptNo: 1,
    });
    const handle = await stageRunner.reserveAndSubmit(stage, attemptCtx, prevStageKey, effective);
    const status = await stageRunner.pollOnce(stage, handle);
    expect(status.done).toBe(true);
    const { artifactId } = await stageRunner.fetchAndFinalize(
      stage,
      attemptCtx,
      handle,
      prevStageKey,
      effective,
    );

    const [row] = await testDb.db
      .select()
      .from(artifact)
      .where(eq(artifact.id, artifactId))
      .limit(1);
    expect(row?.kind).toBe('data');
    expect(row?.data).toEqual({ title: 'Coral Reefs' });
    expect(row?.stale).toBe(false);
    expect(row?.schemaHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
