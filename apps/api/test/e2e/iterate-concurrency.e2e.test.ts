import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { InngestTestEngine, mockCtx } from '@inngest/test';
import type { Context } from 'inngest';
import type { StageDef } from '@reelcraft/shared';
import type { StageExecuteEventData } from '../../src/orchestration/functions/stage-execute.fn';
import type { StageExecuteItemEventData } from '../../src/orchestration/functions/stage-execute-item.fn';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { ChannelService } from '../../src/channel/channel.service';
import { RunService } from '../../src/run/run.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { run, stageExecution, stageItem } from '../../src/db/schema/index';
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
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'data', schema: { type: 'array', items: { type: 'string' } } },
    checks: [],
    retryLimit: 0,
    model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 64, fakeOutput } },
  };
}

function brollStage(concurrency?: number): StageDef {
  return {
    key: 'broll',
    label: 'B-roll',
    capability: 'text.generate',
    config: {},
    slots: { shot: { from: 'item' } },
    context: {},
    iterate: {
      over: { from: 'prev' },
      itemAlias: 'shot',
      itemRetryLimit: 0,
      maxItems: 10,
      ...(concurrency !== undefined ? { concurrency } : {}),
    },
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
 * `stage.execute` running an iterating stage's items in batches of
 * `iterate.concurrency`, with `run-item-*` run through the real
 * `stage.execute.item` (see stage-execute-item-inngest's note on why
 * `step.invoke` is mocked at the step id).
 */
describe('iterate.concurrency (real Inngest steps, e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;
  let stageExecuteFn: TestApp['functions'][number];
  let stageExecuteItemFn: TestApp['functions'][number];

  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb);
    const outer = testApp.functions.find((f) => f.id() === 'stage.execute');
    const inner = testApp.functions.find((f) => f.id() === 'stage.execute.item');
    if (!outer || !inner) throw new Error('stage functions not found');
    stageExecuteFn = outer;
    stageExecuteItemFn = inner;
  });

  afterAll(async () => {
    try {
      await testApp?.close();
    } finally {
      await testDb.teardown();
    }
  });

  async function setUp(graph: StageDef[]) {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);
    const channel = await channels.create('local', {
      name: `Iterate Concurrency ${Date.now()} ${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Iterate Concurrency');
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
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });
    await testDb.db.update(run).set({ state: 'RUNNING' }).where(eq(run.id, created.id));
    const runner = testApp.app.get(StageRunnerService);
    const shots = created.stageExecutions.find((e) => e.stageKey === 'shots')!;
    const { stage, effective, prevStageKey } = await runner.loadStageContext(created.id, 'shots');
    const attempt = await runner.beginAttempt({
      runId: created.id,
      stageExecutionId: shots.id,
      stageKey: 'shots',
    });
    const submitted = await runner.reserveAndSubmit(stage, attempt, prevStageKey, effective);
    if (submitted.outcome !== 'submitted') throw new Error('expected submission');
    await runner.fetchAndFinalize(stage, attempt, submitted.handle, prevStageKey, effective);
    return created;
  }

  /** Runs the stage; `override` replaces an item's work with a canned outcome. */
  async function executeStage(
    created: Awaited<ReturnType<typeof setUp>>,
    itemCount: number,
    override: Record<number, unknown> = {},
  ) {
    const execution = created.stageExecutions.find((e) => e.stageKey === 'broll')!;
    const runner = testApp.app.get(StageRunnerService);
    const events: string[] = [];
    const itemSteps = Array.from({ length: itemCount }, (_, i) => ({
      id: `run-item-${i}`,
      handler: async () => {
        events.push(`start ${i}`);
        if (i in override) {
          events.push(`end ${i}`);
          return override[i];
        }
        const item = await runner.itemState(execution.id, i);
        const data: StageExecuteItemEventData = {
          runId: created.id,
          stageExecutionId: execution.id,
          stageKey: 'broll',
          itemIndex: i,
          stageItemId: item.id,
        };
        const inner = new InngestTestEngine({
          function: stageExecuteItemFn,
          events: [{ name: 'stage/execute.item.requested', data }],
          transformCtx: skipSleepCtx,
        });
        const { result, error } = await inner.execute();
        if (error) throw error;
        events.push(`end ${i}`);
        return result;
      },
    }));
    const data: StageExecuteEventData = {
      runId: created.id,
      stageExecutionId: execution.id,
      stageKey: 'broll',
    };
    const engine = new InngestTestEngine({
      function: stageExecuteFn,
      events: [{ name: 'stage/execute.requested', data }],
      steps: itemSteps,
      transformCtx: skipSleepCtx,
    });
    return { ...(await engine.execute()), execution, events };
  }

  it('runs five items at concurrency 3 as one batch of three, then one of two', async () => {
    const created = await setUp([shotsStage(['a', 'b', 'c', 'd', 'e']), brollStage(3)]);
    const { result, error, execution, events } = await executeStage(created, 5);
    expect(error).toBeUndefined();
    expect(result).toMatchObject({ outcome: 'passed' });

    const last = (name: string) => events.lastIndexOf(name);
    const first = (name: string) => events.indexOf(name);
    for (const early of [0, 1, 2]) {
      for (const late of [3, 4]) {
        expect(last(`end ${early}`)).toBeLessThan(first(`start ${late}`));
      }
    }
    const items = await testDb.db
      .select()
      .from(stageItem)
      .where(eq(stageItem.stageExecutionId, execution.id));
    expect(items.map((i) => i.state)).toEqual(['passed', 'passed', 'passed', 'passed', 'passed']);
    const [row] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, execution.id));
    expect(row?.state).toBe('passed');
  });

  it('lets the rest of a batch finish when one item fails, then starts nothing new', async () => {
    const created = await setUp([shotsStage(['a', 'b', 'c', 'd', 'e']), brollStage(3)]);
    const { result, events } = await executeStage(created, 5, {
      1: { outcome: 'failed', reason: 'ChatGPT is signed out' },
    });
    expect(result).toMatchObject({ outcome: 'failed', reason: 'ChatGPT is signed out' });
    // Items 0 and 2 ran to the end beside the failing one; 3 and 4 never started.
    expect(events).toEqual(expect.arrayContaining(['end 0', 'end 1', 'end 2']));
    expect(events.some((e) => e === 'start 3' || e === 'start 4')).toBe(false);
  });

  it('keeps running one item at a time when concurrency is not set', async () => {
    const created = await setUp([shotsStage(['a', 'b', 'c']), brollStage()]);
    const { result, events } = await executeStage(created, 3);
    expect(result).toMatchObject({ outcome: 'passed' });
    expect(events).toEqual(['start 0', 'end 0', 'start 1', 'end 1', 'start 2', 'end 2']);
  });
});
