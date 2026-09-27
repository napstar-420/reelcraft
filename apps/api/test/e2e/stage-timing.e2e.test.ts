import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { StageDef } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import { InvalidationService } from '../../src/run/invalidation.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { run as runTable } from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

const GRAPH: StageDef[] = [
  {
    key: 'draft',
    label: 'Draft',
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    retryLimit: 0,
    model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 256 } },
  },
];

/**
 * A1 — `stage_execution.started_at` is now written on the first attempt of
 * a stage (`StageRunnerService.beginAttempt`) rather than only for
 * human.input stages, and `RunService.get()`/`StageExecutionDto` now expose
 * both `startedAt`/`endedAt`. Also covers `InvalidationService.apply()`
 * resetting `startedAt` alongside `endedAt` on a full-stage invalidation.
 */
describe('stage execution timing (e2e)', () => {
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

  it('sets startedAt on the first attempt and endedAt when the stage passes', async () => {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);
    const stageRunner = testApp.app.get(StageRunnerService);

    const channel = await channels.create('local', {
      name: `Stage Timing Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Stage Timing Blueprint');
    const version = await blueprints.createVersion(blueprintId, {
      graph: GRAPH,
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
    await testDb.db.update(runTable).set({ state: 'RUNNING' }).where(eq(runTable.id, created.id));

    const beforeStart = await runs.get(created.id);
    const stageExecutionBefore = beforeStart.stageExecutions.find((e) => e.stageKey === 'draft');
    if (!stageExecutionBefore) throw new Error('stage execution not found');
    expect(stageExecutionBefore.startedAt).toBeNull();
    expect(stageExecutionBefore.endedAt).toBeNull();

    const { stage, effective, prevStageKey } = await stageRunner.loadStageContext(
      created.id,
      'draft',
    );
    const attemptCtx = await stageRunner.beginAttempt({
      runId: created.id,
      stageExecutionId: stageExecutionBefore.id,
      stageKey: 'draft',
    });

    const afterBegin = await runs.get(created.id);
    const duringRun = afterBegin.stageExecutions.find((e) => e.stageKey === 'draft');
    expect(duringRun?.startedAt).not.toBeNull();
    expect(duringRun?.endedAt).toBeNull();

    const submission = await stageRunner.reserveAndSubmit(
      stage,
      attemptCtx,
      prevStageKey,
      effective,
    );
    if (submission.outcome !== 'submitted') {
      throw new Error(`expected reserveAndSubmit to submit, got "${submission.outcome}"`);
    }
    await stageRunner.pollOnce(stage, submission.handle);
    const fetched = await stageRunner.fetchAndFinalize(
      stage,
      attemptCtx,
      submission.handle,
      prevStageKey,
      effective,
    );
    if (fetched.outcome !== 'success') throw new Error(`expected success, got ${fetched.outcome}`);

    const afterFinish = await runs.get(created.id);
    const finished = afterFinish.stageExecutions.find((e) => e.stageKey === 'draft');
    expect(finished?.startedAt).toBe(duringRun?.startedAt);
    expect(finished?.endedAt).not.toBeNull();
    expect(new Date(finished!.endedAt!).getTime()).toBeGreaterThanOrEqual(
      new Date(finished!.startedAt!).getTime(),
    );

    // A second beginAttempt (a retry of the same stage) must not push
    // startedAt forward — it's coalesced to the first-ever attempt time.
    await stageRunner.beginAttempt({
      runId: created.id,
      stageExecutionId: stageExecutionBefore.id,
      stageKey: 'draft',
    });
    const afterSecondAttempt = await runs.get(created.id);
    expect(afterSecondAttempt.stageExecutions.find((e) => e.stageKey === 'draft')?.startedAt).toBe(
      finished?.startedAt,
    );

    // Full-stage invalidation resets both timestamps, so a re-run starts clean.
    const invalidation = testApp.app.get(InvalidationService);
    const preview = await invalidation.preview({
      runId: created.id,
      seed: { stageKeys: ['draft'] },
    });
    await testDb.db.transaction((tx) =>
      invalidation.apply(tx, {
        runId: created.id,
        closure: preview.closure,
        targetStageKey: 'draft',
      }),
    );
    const afterInvalidation = await runs.get(created.id);
    const invalidated = afterInvalidation.stageExecutions.find((e) => e.stageKey === 'draft');
    expect(invalidated?.startedAt).toBeNull();
    expect(invalidated?.endedAt).toBeNull();
  });
});
