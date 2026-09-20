import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  InngestTestEngine,
  mockCtx,
  type InngestTestEngine as InngestTestEngineNs,
} from '@inngest/test';
import type { Context } from 'inngest';
import { eq } from 'drizzle-orm';
import type { StageDef } from '@reefcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { ArtifactService } from '../../src/artifact/artifact.service';
import type { StageExecuteEventData } from '../../src/orchestration/functions/stage-execute.fn';
import type { StageExecuteItemEventData } from '../../src/orchestration/functions/stage-execute-item.fn';
import { artifact, run as runTable, stageExecution, stageItem } from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

function skipSleepCtx(ctx: Context.Any): Context.Any {
  const mocked = mockCtx(ctx);
  (mocked.step.sleep as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(
    undefined,
  );
  return mocked;
}

function shotsStage(fakeOutput: string[]): StageDef {
  return {
    key: 'shots',
    label: 'Shots',
    capability: 'llm.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'data', schema: { type: 'array', items: { type: 'string' } } },
    checks: [],
    retryLimit: 0,
    model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 64, fakeOutput } },
  };
}

function brollStage(): StageDef {
  return {
    key: 'broll',
    label: 'B-roll',
    capability: 'llm.generate',
    config: {},
    slots: { shot: { from: 'item' } },
    context: {},
    iterate: { over: { from: 'prev' }, itemAlias: 'shot', itemRetryLimit: 0, maxItems: 10 },
    output: {
      kind: 'data',
      schema: {
        type: 'object',
        properties: { caption: { type: 'string' } },
        required: ['caption'],
      },
    },
    checks: [],
    retryLimit: 0,
    model: {
      provider: 'fake',
      modelId: 'fake-text-1',
      params: { max_tokens: 64, fakeOutput: { caption: 'ok' } },
    },
  };
}

/**
 * §13.1/§13.3, phase 7 chunk 4 — `stage.execute`'s real outer per-item loop
 * and `stage.execute.item`'s real per-item attempt loop, each exercised
 * through `InngestTestEngine` with real (non-mocked) step tools.
 *
 * `step.invoke` itself is NOT something `InngestTestEngine` can resolve
 * locally — the installed Inngest SDK's `invoke` step op is
 * `mode: StepMode.Async` (a real dispatch-and-wait round trip through a
 * live Inngest server), and `@inngest/test` has no support for executing a
 * second, invoked function in-process. `run-orchestrate-inngest.e2e.test.ts`
 * hit exactly this limitation for `run.orchestrate -> stage.execute` and
 * settled on mocking the `invoke-*` step ids via `InngestTestEngine`'s
 * `steps:` option (verified there, by reading the installed source, to
 * resolve identically to a real `step.run`) rather than standing up a live
 * dev server in the test suite — this file follows that same established
 * precedent for `stage.execute -> stage.execute.item`, split into two
 * complementary suites so every real step chain still gets exercised for
 * real:
 *
 *  - `stage.execute.item` (below): the real per-item attempt loop, driven
 *    with NO step mocking at all — proves the item body's own real step
 *    chain (submit/poll/fetch/check/finalize) end to end, exactly like
 *    `stage-execute-inngest.e2e.test.ts` does for the non-iterating path.
 *  - `stage.execute`'s outer loop: `run-item-*` steps mocked (mirroring
 *    `invoke-stage-*` in `run-orchestrate-inngest.e2e.test.ts`), proving the
 *    real outer loop's own step chain — count/assert/ensure/skip-passed/
 *    invoke-payload-shape/bubble-on-failure/finish — all for real.
 */
describe('stage.execute.item (real Inngest steps, e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;
  let stageExecuteItemFn: TestApp['functions'][number];

  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb);
    const fn = testApp.functions.find((f) => f.id() === 'stage.execute.item');
    if (!fn) throw new Error('stage.execute.item function not found');
    stageExecuteItemFn = fn;
  });

  afterAll(async () => {
    try {
      await testApp?.close();
    } finally {
      await testDb.teardown();
    }
  });

  async function setupRun(graph: StageDef[]) {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);
    const channel = await channels.create('local', {
      name: `Stage Execute Item Inngest Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Stage Execute Item Inngest');
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
    await testDb.db.update(runTable).set({ state: 'RUNNING' }).where(eq(runTable.id, created.id));
    return created;
  }

  async function passShotsStage(runner: StageRunnerService, runId: string, executionId: string) {
    const { stage, effective, prevStageKey } = await runner.loadStageContext(runId, 'shots');
    const attempt = await runner.beginAttempt({
      runId,
      stageExecutionId: executionId,
      stageKey: 'shots',
    });
    const submitted = await runner.reserveAndSubmit(stage, attempt, prevStageKey, effective);
    if (submitted.outcome !== 'submitted') throw new Error('expected submission');
    const result = await runner.fetchAndFinalize(
      stage,
      attempt,
      submitted.handle,
      prevStageKey,
      effective,
    );
    if (result.outcome !== 'success') throw new Error('expected success');
  }

  async function executeItem(data: StageExecuteItemEventData) {
    const engine = new InngestTestEngine({
      function: stageExecuteItemFn,
      events: [{ name: 'stage/execute.item.requested', data }],
      transformCtx: skipSleepCtx,
    });
    return engine.execute();
  }

  it('runs one item to completion with a real step chain, writing to stage_item not stage_execution', async () => {
    const graph = [shotsStage(['a', 'b']), brollStage()];
    const created = await setupRun(graph);
    const runner = testApp.app.get(StageRunnerService);
    const shotsExecution = created.stageExecutions.find((e) => e.stageKey === 'shots')!;
    const brollExecution = created.stageExecutions.find((e) => e.stageKey === 'broll')!;
    await passShotsStage(runner, created.id, shotsExecution.id);
    await runner.ensureStageItems(brollExecution.id, 2);
    const item0 = await runner.itemState(brollExecution.id, 0);

    const { result, error } = await executeItem({
      runId: created.id,
      stageExecutionId: brollExecution.id,
      stageKey: 'broll',
      itemIndex: 0,
      stageItemId: item0.id,
    });

    expect(error).toBeUndefined();
    expect(result).toMatchObject({ outcome: 'passed' });

    const [itemRow] = await testDb.db.select().from(stageItem).where(eq(stageItem.id, item0.id));
    expect(itemRow?.state).toBe('passed');
    expect(itemRow?.attemptCount).toBe(1);
    expect(itemRow?.outputArtifactId).toBeTruthy();

    // The item's own finalize must NOT touch stage_execution — that's
    // `finishIteratingStage`'s job, run only after every item passes.
    const [executionRow] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, brollExecution.id));
    expect(executionRow?.state).not.toBe('passed');
  });
});

/**
 * See the module docstring above for why `run-item-*` invokes are mocked
 * here rather than executed for real — mirrors
 * `run-orchestrate-inngest.e2e.test.ts`'s established pattern for
 * `invoke-stage-*`.
 */
describe("stage.execute's outer per-item loop (real Inngest steps, mocked stage.execute.item, e2e)", () => {
  let testDb: TestDb;
  let testApp: TestApp;
  let stageExecuteFn: TestApp['functions'][number];

  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb);
    const fn = testApp.functions.find((f) => f.id() === 'stage.execute');
    if (!fn) throw new Error('stage.execute function not found');
    stageExecuteFn = fn;
  });

  afterAll(async () => {
    try {
      await testApp?.close();
    } finally {
      await testDb.teardown();
    }
  });

  async function setupRun(graph: StageDef[]) {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);
    const channel = await channels.create('local', {
      name: `Stage Execute Outer Loop Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Stage Execute Outer Loop');
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
    await testDb.db.update(runTable).set({ state: 'RUNNING' }).where(eq(runTable.id, created.id));
    return created;
  }

  async function passShotsStage(runId: string, executionId: string) {
    const runner = testApp.app.get(StageRunnerService);
    const { stage, effective, prevStageKey } = await runner.loadStageContext(runId, 'shots');
    const attempt = await runner.beginAttempt({
      runId,
      stageExecutionId: executionId,
      stageKey: 'shots',
    });
    const submitted = await runner.reserveAndSubmit(stage, attempt, prevStageKey, effective);
    if (submitted.outcome !== 'submitted') throw new Error('expected submission');
    const result = await runner.fetchAndFinalize(
      stage,
      attempt,
      submitted.handle,
      prevStageKey,
      effective,
    );
    if (result.outcome !== 'success') throw new Error('expected success');
  }

  async function execute(
    data: StageExecuteEventData,
    steps: NonNullable<InngestTestEngineNs.Options['steps']>,
  ) {
    const engine = new InngestTestEngine({
      function: stageExecuteFn,
      events: [{ name: 'stage/execute.requested', data }],
      steps,
    });
    return engine.execute();
  }

  it('a 3-item iterating stage completes with outputArtifactId pointing at the last item and itemCount recorded', async () => {
    const graph = [shotsStage(['s0', 's1', 's2']), brollStage()];
    const created = await setupRun(graph);
    const shotsExecution = created.stageExecutions.find((e) => e.stageKey === 'shots')!;
    const brollExecution = created.stageExecutions.find((e) => e.stageKey === 'broll')!;
    await passShotsStage(created.id, shotsExecution.id);
    const runner = testApp.app.get(StageRunnerService);
    const artifacts = testApp.app.get(ArtifactService);
    const itemArtifactIds: string[] = [];

    const invoked: number[] = [];
    const { result, error } = await execute(
      { runId: created.id, stageExecutionId: brollExecution.id, stageKey: 'broll' },
      [0, 1, 2].map((i) => ({
        id: `run-item-${i}`,
        // The invoke itself is mocked (see the module docstring), so this
        // handler stands in for what a real `stage.execute.item` run would
        // have persisted: `finishIteratingStage` reads the last item's
        // `outputArtifactId` straight from `stage_item` (an FK to a real
        // `artifact` row), so the mock has to create and wire up a real
        // artifact, not just return a value to the caller.
        handler: async () => {
          invoked.push(i);
          const item = await runner.itemState(brollExecution.id, i);
          const artifactId = await artifacts.recordAttemptArtifact({
            runId: created.id,
            producerStageKey: 'broll',
            itemIndex: i,
            kind: 'data',
            data: { caption: 'ok' },
            reproLevel: 'exact',
            costUsd: 0,
          });
          await testDb.db.update(artifact).set({ stale: false }).where(eq(artifact.id, artifactId));
          await testDb.db
            .update(stageItem)
            .set({ state: 'passed', outputArtifactId: artifactId, attemptCount: 1 })
            .where(eq(stageItem.id, item.id));
          itemArtifactIds.push(artifactId);
          return { outcome: 'passed', artifactId };
        },
      })),
    );

    expect(error).toBeUndefined();
    expect(itemArtifactIds).toHaveLength(3);
    expect(result).toEqual({ outcome: 'passed', artifactId: itemArtifactIds[2] });
    expect(invoked).toEqual([0, 1, 2]);

    const [executionRow] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, brollExecution.id));
    expect(executionRow?.itemCount).toBe(3);
    expect(executionRow?.isIterating).toBe(true);
    expect(executionRow?.state).toBe('passed');
    expect(executionRow?.outputArtifactId).toBe(itemArtifactIds[2]);

    const items = await testDb.db
      .select()
      .from(stageItem)
      .where(eq(stageItem.stageExecutionId, brollExecution.id))
      .orderBy(stageItem.itemIndex);
    expect(items).toHaveLength(3);
  });

  it('skips an already-passed item without invoking it, and bubbles a non-passed item outcome unchanged', async () => {
    const graph = [shotsStage(['s0', 's1', 's2']), brollStage()];
    const created = await setupRun(graph);
    const shotsExecution = created.stageExecutions.find((e) => e.stageKey === 'shots')!;
    const brollExecution = created.stageExecutions.find((e) => e.stageKey === 'broll')!;
    await passShotsStage(created.id, shotsExecution.id);

    const runner = testApp.app.get(StageRunnerService);
    // Pre-seed stage_item rows and mark item 0 already 'passed', simulating
    // a resumed run whose item 0 finished in an earlier invocation.
    await runner.ensureStageItems(brollExecution.id, 3);
    const item0 = await runner.itemState(brollExecution.id, 0);
    await testDb.db.update(stageItem).set({ state: 'passed' }).where(eq(stageItem.id, item0.id));

    const invoked: number[] = [];
    const { result, error } = await execute(
      { runId: created.id, stageExecutionId: brollExecution.id, stageKey: 'broll' },
      [
        {
          id: 'run-item-0',
          handler: () => {
            throw new Error('regression: an already-passed item was re-invoked');
          },
        },
        {
          id: 'run-item-1',
          handler: () => {
            invoked.push(1);
            return { outcome: 'failed', reason: 'check_failed' };
          },
        },
        {
          id: 'run-item-2',
          handler: () => {
            invoked.push(2);
            return { outcome: 'passed', artifactId: 'fake-item-artifact-2' };
          },
        },
      ],
    );

    expect(error).toBeUndefined();
    expect(result).toEqual({ outcome: 'failed', reason: 'check_failed' });
    expect(invoked).toEqual([1]); // item 2 never runs — no continue-and-isolate (§14.1)
  });
});
