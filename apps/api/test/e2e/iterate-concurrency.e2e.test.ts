import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { InngestTestEngine, mockCtx } from '@inngest/test';
import type { Context } from 'inngest';
import type { StageDef } from '@reelcraft/shared';
import type { StageExecuteEventData } from '../../src/orchestration/functions/stage-execute.fn';
import type { StageExecuteItemEventData } from '../../src/orchestration/functions/stage-execute-item.fn';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { HumanActionService } from '../../src/run/human-action.service';
import { ChannelService } from '../../src/channel/channel.service';
import { RunService } from '../../src/run/run.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import {
  humanWait,
  run,
  runWakeup,
  stageAttempt,
  stageExecution,
  stageItem,
} from '../../src/db/schema/index';
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

function brollStage(concurrency?: number, approval?: StageDef['approval']): StageDef {
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
    ...(approval ? { approval } : {}),
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
    // The stage itself is marked failed, with the item's reason, once the batch settled.
    const broll = (
      await testDb.db.select().from(stageExecution).where(eq(stageExecution.runId, created.id))
    ).find((e) => e.stageKey === 'broll');
    expect(broll?.state).toBe('failed');
    expect(broll?.failure).toEqual({ reason: 'Item 2: ChatGPT is signed out' });
    expect(broll?.endedAt).not.toBeNull();
  });

  it('names how many items failed when several do', async () => {
    const created = await setUp([shotsStage(['a', 'b', 'c', 'd', 'e']), brollStage(3)]);
    await executeStage(created, 5, {
      0: { outcome: 'failed', reason: 'first' },
      2: { outcome: 'failed', reason: 'second' },
    });
    const broll = (
      await testDb.db.select().from(stageExecution).where(eq(stageExecution.runId, created.id))
    ).find((e) => e.stageKey === 'broll');
    expect(broll?.failure).toEqual({ reason: '2 items failed; first, item 1: first' });
  });

  describe('beginAttempt on a stage that ran before', () => {
    async function brollRow(runId: string) {
      const rows = await testDb.db
        .select()
        .from(stageExecution)
        .where(eq(stageExecution.runId, runId));
      return rows.find((e) => e.stageKey === 'broll')!;
    }

    it('flips a failed stage back to running, clearing its failure, for concurrent items', async () => {
      const created = await setUp([shotsStage(['a', 'b', 'c']), brollStage(3)]);
      const execution = await brollRow(created.id);
      await testDb.db
        .update(stageExecution)
        .set({ state: 'failed', failure: { reason: 'x' }, endedAt: new Date().toISOString() })
        .where(eq(stageExecution.id, execution.id));
      const runner = testApp.app.get(StageRunnerService);
      await runner.ensureStageItems(execution.id, 3);

      const attempts = await Promise.all(
        [0, 1, 2].map(async (i) =>
          runner.beginAttempt({
            runId: created.id,
            stageExecutionId: execution.id,
            stageKey: 'broll',
            itemIndex: i,
            stageItemId: (await runner.itemState(execution.id, i)).id,
          }),
        ),
      );

      expect(new Set(attempts.map((a) => a.stageAttemptId)).size).toBe(3);
      const row = await brollRow(created.id);
      expect(row.state).toBe('running');
      expect(row.failure).toBeNull();
      expect(row.endedAt).toBeNull();
    });

    it('leaves a stage that is awaiting approval alone', async () => {
      const created = await setUp([shotsStage(['a', 'b']), brollStage(2)]);
      const execution = await brollRow(created.id);
      await testDb.db
        .update(stageExecution)
        .set({ state: 'awaiting_approval' })
        .where(eq(stageExecution.id, execution.id));
      const runner = testApp.app.get(StageRunnerService);
      await runner.ensureStageItems(execution.id, 2);

      await runner.beginAttempt({
        runId: created.id,
        stageExecutionId: execution.id,
        stageKey: 'broll',
        itemIndex: 0,
        stageItemId: (await runner.itemState(execution.id, 0)).id,
      });

      expect((await brollRow(created.id)).state).toBe('awaiting_approval');
    });
  });

  it('keeps running one item at a time when concurrency is not set', async () => {
    const created = await setUp([shotsStage(['a', 'b', 'c']), brollStage()]);
    const { result, events } = await executeStage(created, 3);
    expect(result).toMatchObject({ outcome: 'passed' });
    expect(events).toEqual(['start 0', 'end 0', 'start 1', 'end 1', 'start 2', 'end 2']);
  });

  describe('with a human approval on every item', () => {
    const itemApproval = { mode: 'item' as const };

    async function itemRows(executionId: string) {
      const rows = await testDb.db
        .select()
        .from(stageItem)
        .where(eq(stageItem.stageExecutionId, executionId));
      return rows.sort((a, b) => a.itemIndex - b.itemIndex);
    }
    const openWaits = (executionId: string) =>
      testDb.db
        .select()
        .from(humanWait)
        .where(and(eq(humanWait.stageExecutionId, executionId), isNull(humanWait.resolvedAt)));
    const wakeups = async (runId: string) =>
      (await testDb.db.select().from(runWakeup).where(eq(runWakeup.runId, runId))).length;
    const setRunState = (runId: string, state: 'RUNNING' | 'PAUSED_APPROVAL') =>
      testDb.db
        .update(run)
        .set({ state, ...(state === 'PAUSED_APPROVAL' ? { cursorStageKey: 'broll' } : {}) })
        .where(eq(run.id, runId));

    async function everyItemWaiting() {
      const created = await setUp([shotsStage(['a', 'b', 'c']), brollStage(3, itemApproval)]);
      const first = await executeStage(created, 3);
      expect(first.error).toBeUndefined();
      expect(first.result).toMatchObject({ outcome: 'approval_required' });
      await setRunState(created.id, 'PAUSED_APPROVAL');
      return { created, execution: first.execution };
    }

    it('lets every item of a batch wait at once, and pauses the stage after the batch', async () => {
      const { execution } = await everyItemWaiting();
      expect((await itemRows(execution.id)).map((i) => i.state)).toEqual([
        'awaiting_approval',
        'awaiting_approval',
        'awaiting_approval',
      ]);
      const waits = await openWaits(execution.id);
      expect(waits).toHaveLength(3);
      expect(new Set(waits.map((w) => w.stageItemId)).size).toBe(3);
    });

    it('approves them one at a time, and only wakes the run when none is left', async () => {
      const { created, execution } = await everyItemWaiting();
      const actions = testApp.app.get(HumanActionService);
      const runs = testApp.app.get(RunService);
      const before = await wakeups(created.id);

      // Which item is meant must be said while several wait.
      await expect(actions.approve(created.id, 'broll')).rejects.toThrow(/Several items/);

      const candidate = await runs.approvalCandidate(created.id, 'broll');
      expect(candidate.itemIndex).toBe(0);
      expect(candidate.pendingItemIndexes).toEqual([0, 1, 2]);
      expect((await runs.approvalCandidate(created.id, 'broll', 2)).itemIndex).toBe(2);

      await actions.approve(created.id, 'broll', 1);
      expect((await itemRows(execution.id)).map((i) => i.state)).toEqual([
        'awaiting_approval',
        'passed',
        'awaiting_approval',
      ]);
      expect(await openWaits(execution.id)).toHaveLength(2);
      expect((await runs.approvalCandidate(created.id, 'broll')).pendingItemIndexes).toEqual([
        0, 2,
      ]);
      await actions.approve(created.id, 'broll', 0);
      expect(await wakeups(created.id)).toBe(before);

      await actions.approve(created.id, 'broll', 2);
      expect(await openWaits(execution.id)).toHaveLength(0);
      expect(await wakeups(created.id)).toBe(before + 1);

      // The run resumes: nothing is left to do, so the stage passes.
      await setRunState(created.id, 'RUNNING');
      const resumed = await executeStage(created, 3);
      expect(resumed.result).toMatchObject({ outcome: 'passed' });
      const [row] = await testDb.db
        .select()
        .from(stageExecution)
        .where(eq(stageExecution.id, execution.id));
      expect(row?.state).toBe('passed');
    });

    it('redoes a rejected item on resume while the others keep waiting or passed', async () => {
      const { created, execution } = await everyItemWaiting();
      const actions = testApp.app.get(HumanActionService);
      const before = await wakeups(created.id);

      const previewed = await actions.reject(created.id, 'broll', 'brighter', undefined, 2);
      if (!('previewToken' in previewed)) throw new Error('expected a preview');
      await actions.reject(created.id, 'broll', 'brighter', previewed.previewToken, 2);
      expect((await itemRows(execution.id)).map((i) => i.state)).toEqual([
        'awaiting_approval',
        'awaiting_approval',
        'stale',
      ]);
      // Two items still wait for a person: the run stays paused.
      expect(await openWaits(execution.id)).toHaveLength(2);
      expect(await wakeups(created.id)).toBe(before);

      await actions.approve(created.id, 'broll', 0);
      await actions.approve(created.id, 'broll', 1);
      expect(await wakeups(created.id)).toBe(before + 1);

      await setRunState(created.id, 'RUNNING');
      const resumed = await executeStage(created, 3);
      // Only item 2 ran again, and it waits for its own approval.
      expect(resumed.result).toMatchObject({ outcome: 'approval_required' });
      expect((await itemRows(execution.id)).map((i) => i.state)).toEqual([
        'passed',
        'passed',
        'awaiting_approval',
      ]);
      const items = await itemRows(execution.id);
      const attempts = await testDb.db
        .select()
        .from(stageAttempt)
        .where(eq(stageAttempt.stageItemId, items[2]!.id));
      expect(attempts).toHaveLength(2);
    });

    it('does not run an item again that still waits when the stage is re-entered', async () => {
      const { created, execution } = await everyItemWaiting();
      const before = await testDb.db
        .select()
        .from(stageAttempt)
        .where(eq(stageAttempt.stageExecutionId, execution.id));
      await setRunState(created.id, 'RUNNING');
      const again = await executeStage(created, 3);
      expect(again.result).toMatchObject({ outcome: 'approval_required' });
      expect(again.events).toEqual([]);
      const after = await testDb.db
        .select()
        .from(stageAttempt)
        .where(eq(stageAttempt.stageExecutionId, execution.id));
      expect(after).toHaveLength(before.length);
    });
  });
});
