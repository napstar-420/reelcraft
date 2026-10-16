import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { StageDef } from '@reelcraft/shared';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { ChannelService } from '../../src/channel/channel.service';
import { ProviderRegistry } from '../../src/provider/provider.registry';
import { RunService } from '../../src/run/run.service';
import { InvalidationService } from '../../src/run/invalidation.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { runStageAttemptLoop } from '../../src/orchestration/functions/stage-attempt-loop';
import { artifact, run, stageAttempt } from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';
import { mockQcOutcomes } from '../support/mock-qc-outcomes';

describe('per-scene reference selection (e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;
  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await testApp?.close();
    await testDb?.teardown();
  });

  function imageStage(key: string, items: unknown[]): StageDef {
    return {
      key,
      label: key,
      capability: 'image.generate',
      config: {},
      slots: {},
      context: {},
      instructions: { template: 'Make one reference image.' },
      output: { kind: 'media.image' },
      checks: [],
      retryLimit: 0,
      iterate: { over: { from: 'const', value: items }, itemAlias: 'item', itemRetryLimit: 0 },
      model: { provider: 'fake', modelId: 'fake-image-1', params: {} },
    };
  }

  async function setup(keys = ['alice', 'bob', 'castle'], wanted = [['bob', 'castle'], ['alice']]) {
    const sheets = imageStage(
      'sheets',
      keys.map((key) => ({ key })),
    );
    const scenes = imageStage(
      'scenes',
      wanted.map((referenceKeys) => ({ referenceKeys })),
    );
    scenes.slots.references = {
      from: 'stage',
      stageKey: 'sheets',
      match: { sourcePath: 'key', itemPath: 'referenceKeys' },
    };
    scenes.qc = {
      criteria: 'Match the references.',
      threshold: 70,
      includeInputs: false,
      maxAttempts: 1,
      model: { provider: 'fake', modelId: 'fake-judge-1', params: {} },
    };
    const channel = await testApp.app.get(ChannelService).create('local', {
      name: `Reference selection ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprints = testApp.app.get(BlueprintService);
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Reference selection');
    const version = await blueprints.createVersion(blueprintId, {
      graph: [sheets, scenes],
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    expect(version.runnable).toBe(true);
    const created = await testApp.app.get(RunService).create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });
    await testDb.db.update(run).set({ state: 'RUNNING' }).where(eq(run.id, created.id));
    return { created, channel, version };
  }

  async function prepare(runId: string, executionId: string, stageKey: string) {
    const runner = testApp.app.get(StageRunnerService);
    const context = await runner.loadStageContext(runId, stageKey);
    const count = await runner.resolveIterateCount(
      runId,
      executionId,
      context.stage,
      context.effective,
      context.prevStageKey,
    );
    if (!count.ok) throw new Error(count.reason);
    await runner.ensureStageItems(executionId, count.itemCount);
    return context;
  }

  async function passItem(runId: string, executionId: string, stageKey: string, itemIndex: number) {
    const runner = testApp.app.get(StageRunnerService);
    const { stage, effective, prevStageKey } = await runner.loadStageContext(runId, stageKey);
    const item = await runner.itemState(executionId, itemIndex);
    return runStageAttemptLoop({
      step: { run: (_id: string, fn: () => unknown) => fn(), sleep: vi.fn() } as never,
      logger: { warn: vi.fn() } as never,
      runner,
      stage,
      effective,
      prevStageKey,
      runId,
      stageExecutionId: executionId,
      stageKey,
      retryLimit: 0,
      itemIndex,
      stageItemId: item.id,
    });
  }

  async function passSheets(created: Awaited<ReturnType<typeof setup>>['created']) {
    const executionId = created.stageExecutions[0]!.id;
    await prepare(created.id, executionId, 'sheets');
    for (let index = 0; index < 3; index++) {
      expect(await passItem(created.id, executionId, 'sheets', index)).toMatchObject({
        outcome: 'passed',
      });
    }
    await testApp.app.get(StageRunnerService).finishIteratingStage(executionId);
    return testDb.db
      .select()
      .from(artifact)
      .where(
        and(
          eq(artifact.runId, created.id),
          eq(artifact.producerStageKey, 'sheets'),
          eq(artifact.stale, false),
        ),
      )
      .orderBy(artifact.itemIndex);
  }

  it('submits only selected references, shares them with QC, snapshots and seeds identity', async () => {
    const { created, channel, version } = await setup();
    const sheets = await passSheets(created);
    expect(sheets.map((row) => row.iterationValue)).toEqual([
      { key: 'alice' },
      { key: 'bob' },
      { key: 'castle' },
    ]);
    const runner = testApp.app.get(StageRunnerService);
    const judge = mockQcOutcomes(runner, {
      status: 'passed',
      verdict: { score: 90, critique: 'Good.' },
      costUsd: 0,
    });
    const submit = vi.spyOn(testApp.app.get(ProviderRegistry).get('fake'), 'submit');
    const executionId = created.stageExecutions[1]!.id;
    await prepare(created.id, executionId, 'scenes');
    for (let index = 0; index < 2; index++)
      expect(await passItem(created.id, executionId, 'scenes', index)).toMatchObject({
        outcome: 'passed',
      });
    await runner.finishIteratingStage(executionId);
    const references = submit.mock.calls.map(
      ([request]) =>
        request.params.slots as { references: Array<{ artifactId: string; sourceKey: string }> },
    );
    expect(references.map((slots) => slots.references.map((image) => image.artifactId))).toEqual([
      [sheets[1]!.id, sheets[2]!.id],
      [sheets[0]!.id],
    ]);
    for (let index = 0; index < 2; index++) {
      const envelope = judge.submit.mock.calls[index]![0];
      expect(envelope.media).toBeDefined();
      expect(envelope.referenceImages?.map((image) => image.sourceKey)).toEqual(
        references[index]!.references.map((image) => image.sourceKey),
      );
    }
    const attempts = await testDb.db
      .select()
      .from(stageAttempt)
      .where(eq(stageAttempt.stageExecutionId, executionId))
      .orderBy(stageAttempt.attemptNo);
    expect(attempts[0]!.resolvedInputs).toMatchObject({
      'slots.references': { artifactIds: [sheets[1]!.id, sheets[2]!.id] },
    });
    await testDb.db.update(run).set({ state: 'COMPLETED' }).where(eq(run.id, created.id));
    const seeded = await testApp.app.get(RunService).create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
      seedFromRunId: created.id,
    });
    const copied = await testDb.db
      .select()
      .from(artifact)
      .where(and(eq(artifact.runId, seeded.id), eq(artifact.producerStageKey, 'sheets')))
      .orderBy(artifact.itemIndex);
    expect(copied.map((row) => row.iterationValue)).toEqual(
      sheets.map((row) => row.iterationValue),
    );
  });

  it.each(['missing', 'ambiguous'] as const)(
    'rejects %s matches before provider submission',
    async (problem) => {
      const { created } = await setup(
        problem === 'ambiguous' ? ['alice', 'bob', 'bob'] : undefined,
        [[problem === 'missing' ? 'dragon' : 'bob']],
      );
      await passSheets(created);
      const executionId = created.stageExecutions[1]!.id;
      const context = await prepare(created.id, executionId, 'scenes');
      const runner = testApp.app.get(StageRunnerService);
      const item = await runner.itemState(executionId, 0);
      const attempt = await runner.beginAttempt({
        runId: created.id,
        stageExecutionId: executionId,
        stageKey: 'scenes',
        itemIndex: 0,
        stageItemId: item.id,
      });
      const submit = vi.spyOn(testApp.app.get(ProviderRegistry).get('fake'), 'submit');
      await expect(
        runner.reserveAndSubmit(context.stage, attempt, context.prevStageKey, context.effective),
      ).rejects.toThrow(problem === 'missing' ? 'no active item' : 'multiple active items');
      expect(submit).not.toHaveBeenCalled();
    },
  );

  it('invalidates only scenes that selected the regenerated reference', async () => {
    const { created } = await setup(['alice', 'bob', 'castle'], [['bob'], ['alice']]);
    await passSheets(created);
    const runner = testApp.app.get(StageRunnerService);
    mockQcOutcomes(runner, {
      status: 'passed',
      verdict: { score: 90, critique: 'Good.' },
      costUsd: 0,
    });
    const executionId = created.stageExecutions[1]!.id;
    await prepare(created.id, executionId, 'scenes');
    for (let index = 0; index < 2; index++)
      await passItem(created.id, executionId, 'scenes', index);
    await runner.finishIteratingStage(executionId);
    const invalidation = testApp.app.get(InvalidationService);
    for (const [sourceIndex, sceneIndex] of [
      [1, 0],
      [0, 1],
    ]) {
      const preview = await invalidation.preview({
        runId: created.id,
        seed: { items: [{ stageKey: 'sheets', itemIndex: sourceIndex! }] },
      });
      expect(
        preview.closure.affectedItems
          .filter((item) => item.stageKey === 'scenes')
          .map((item) => item.itemIndex),
      ).toEqual([sceneIndex]);
    }
    const unrelated = await invalidation.preview({
      runId: created.id,
      seed: { items: [{ stageKey: 'sheets', itemIndex: 2 }] },
    });
    expect(unrelated.closure.affectedStageKeys).toEqual(['sheets']);
    const bob = await invalidation.preview({
      runId: created.id,
      seed: { items: [{ stageKey: 'sheets', itemIndex: 1 }] },
    });
    await testDb.db.transaction((tx) =>
      invalidation.apply(tx, { runId: created.id, closure: bob.closure, targetStageKey: 'sheets' }),
    );
    const scenes = await testDb.db
      .select()
      .from(artifact)
      .where(and(eq(artifact.runId, created.id), eq(artifact.producerStageKey, 'scenes')))
      .orderBy(artifact.itemIndex);
    expect(scenes.map((row) => row.stale)).toEqual([true, false]);
    expect(await passItem(created.id, created.stageExecutions[0]!.id, 'sheets', 1)).toMatchObject({
      outcome: 'passed',
    });
    expect(await passItem(created.id, executionId, 'scenes', 0)).toMatchObject({
      outcome: 'passed',
    });
    const [newBob] = await testDb.db
      .select()
      .from(artifact)
      .where(
        and(
          eq(artifact.runId, created.id),
          eq(artifact.producerStageKey, 'sheets'),
          eq(artifact.itemIndex, 1),
          eq(artifact.stale, false),
        ),
      );
    expect(newBob?.iterationValue).toEqual({ key: 'bob' });
    const alice = await invalidation.preview({
      runId: created.id,
      seed: { items: [{ stageKey: 'sheets', itemIndex: 0 }] },
    });
    await testDb.db.transaction((tx) =>
      invalidation.apply(tx, {
        runId: created.id,
        closure: alice.closure,
        targetStageKey: 'sheets',
      }),
    );
    const activeScenes = await testDb.db
      .select()
      .from(artifact)
      .where(
        and(
          eq(artifact.runId, created.id),
          eq(artifact.producerStageKey, 'scenes'),
          eq(artifact.stale, false),
        ),
      );
    expect(activeScenes.map((row) => row.itemIndex)).toEqual([0]);
  });
});
