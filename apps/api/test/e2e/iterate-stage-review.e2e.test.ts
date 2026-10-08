import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { InngestTestEngine, mockCtx } from '@inngest/test';
import type { Context } from 'inngest';
import type { StageDef } from '@reelcraft/shared';
import type { EffectiveStageConfig } from '../../src/run-config/config-resolver.service';
import type { StageExecuteEventData } from '../../src/orchestration/functions/stage-execute.fn';
import type { StageExecuteItemEventData } from '../../src/orchestration/functions/stage-execute-item.fn';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { ChannelService } from '../../src/channel/channel.service';
import { RunService } from '../../src/run/run.service';
import { HumanActionService } from '../../src/run/human-action.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import {
  artifact,
  humanWait,
  run,
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

const QC_FAILS: NonNullable<StageDef['qc']> = {
  criteria: 'be good',
  threshold: 70,
  includeInputs: false,
  model: {
    provider: 'fake',
    modelId: 'fake-text-1',
    params: { fakeOutput: { score: 10, critique: 'not good enough' } },
  },
  maxAttempts: 1,
  onExhausted: 'human_review',
};
const QC_UNAVAILABLE: NonNullable<StageDef['qc']> = {
  criteria: 'be good',
  threshold: 70,
  includeInputs: false,
  model: { provider: 'fake', modelId: 'fake-text-1:fail:transport', params: { max_tokens: 64 } },
};

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

function brollStage(over: Partial<Pick<StageDef, 'approval' | 'qc'>> = {}): StageDef {
  return {
    key: 'broll',
    label: 'B-roll',
    capability: 'text.generate',
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
    ...over,
  };
}

/** The same stage and config without its QC, for the items that should pass. */
function withoutQc(stage: StageDef, effective: EffectiveStageConfig) {
  const { qc: _stageQc, ...plainStage } = stage;
  const { qc: _effectiveQc, ...plainEffective } = effective;
  return { stage: plainStage as StageDef, effective: plainEffective as EffectiveStageConfig };
}

/**
 * An iterating stage in 'stage' approval mode is reviewed once, after its last
 * item: items finalize as they pass, one QC gave up on is held, and a single
 * review (held items first) opens at the end. Driven through the runner and
 * `HumanActionService` directly, in the style of `item-approval.e2e.test.ts`.
 */
describe('iterating stage reviewed once, at its end (e2e)', () => {
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

  async function createRun(graph: StageDef[]) {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);
    const channel = await channels.create('local', {
      name: `Stage Review ${Date.now()} ${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Stage Review');
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
    return created;
  }

  async function passShots(runner: StageRunnerService, runId: string) {
    const { stage, effective, prevStageKey } = await runner.loadStageContext(runId, 'shots');
    const [row] = await testDb.db
      .select()
      .from(stageExecution)
      .where(and(eq(stageExecution.runId, runId), eq(stageExecution.stageKey, 'shots')));
    const attempt = await runner.beginAttempt({
      runId,
      stageExecutionId: row!.id,
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

  async function setUp(graph: StageDef[], itemCount: number) {
    const created = await createRun(graph);
    const runner = testApp.app.get(StageRunnerService);
    await passShots(runner, created.id);
    const execution = created.stageExecutions.find((e) => e.stageKey === 'broll')!;
    const { stage, effective, prevStageKey } = await runner.loadStageContext(created.id, 'broll');
    await runner.ensureStageItems(execution.id, itemCount);
    return { created, runner, execution, stage, effective, prevStageKey };
  }

  async function runItem(
    ctx: Awaited<ReturnType<typeof setUp>>,
    itemIndex: number,
    variant: { stage: StageDef; effective: EffectiveStageConfig } = ctx,
  ) {
    const item = await ctx.runner.itemState(ctx.execution.id, itemIndex);
    const attempt = await ctx.runner.beginAttempt({
      runId: ctx.created.id,
      stageExecutionId: ctx.execution.id,
      stageKey: 'broll',
      itemIndex,
      stageItemId: item.id,
    });
    const submitted = await ctx.runner.reserveAndSubmit(
      variant.stage,
      attempt,
      ctx.prevStageKey,
      variant.effective,
    );
    if (submitted.outcome !== 'submitted') throw new Error(`unexpected ${submitted.outcome}`);
    const result = await ctx.runner.fetchAndFinalize(
      variant.stage,
      attempt,
      submitted.handle,
      ctx.prevStageKey,
      variant.effective,
    );
    return { attempt, result, item };
  }

  async function pauseForApproval(runId: string) {
    await testDb.db
      .update(run)
      .set({ state: 'PAUSED_APPROVAL', cursorStageKey: 'broll' })
      .where(eq(run.id, runId));
  }

  async function executionRow(id: string) {
    const [row] = await testDb.db.select().from(stageExecution).where(eq(stageExecution.id, id));
    return row!;
  }
  async function itemRows(executionId: string) {
    const rows = await testDb.db
      .select()
      .from(stageItem)
      .where(eq(stageItem.stageExecutionId, executionId));
    return rows.sort((a, b) => a.itemIndex - b.itemIndex);
  }
  async function openWaits(executionId: string) {
    return testDb.db
      .select()
      .from(humanWait)
      .where(and(eq(humanWait.stageExecutionId, executionId), isNull(humanWait.resolvedAt)));
  }

  it("approval mode 'stage' on an iterating stage: items finalize as they pass, one review opens at the end, and approving passes the stage", async () => {
    const ctx = await setUp(
      [shotsStage(['a', 'b', 'c']), brollStage({ approval: { mode: 'stage' } })],
      3,
    );
    for (let i = 0; i < 3; i += 1) {
      expect((await runItem(ctx, i)).result.outcome).toBe('success');
    }
    expect((await itemRows(ctx.execution.id)).map((i) => i.state)).toEqual([
      'passed',
      'passed',
      'passed',
    ]);
    // No wait while the items run: the review is for the whole stage, at the end.
    expect(await openWaits(ctx.execution.id)).toHaveLength(0);

    const concluded = await ctx.runner.concludeIteratingStage(ctx.stage, {
      runId: ctx.created.id,
      stageExecutionId: ctx.execution.id,
    });
    expect(concluded.outcome).toBe('approval_required');
    expect((await executionRow(ctx.execution.id)).state).toBe('awaiting_approval');
    const waits = await openWaits(ctx.execution.id);
    expect(waits).toHaveLength(1);
    expect(waits[0]?.stageItemId).toBeNull();

    await pauseForApproval(ctx.created.id);
    await testApp.app.get(HumanActionService).approve(ctx.created.id, 'broll');

    const finished = await executionRow(ctx.execution.id);
    const items = await itemRows(ctx.execution.id);
    expect(finished.state).toBe('passed');
    expect(finished.outputArtifactId).toBe(items[2]?.outputArtifactId);
    expect(await openWaits(ctx.execution.id)).toHaveLength(0);
  });

  it('a stage with no approval and nothing held goes straight to passed, with no review', async () => {
    const ctx = await setUp([shotsStage(['a', 'b']), brollStage()], 2);
    for (let i = 0; i < 2; i += 1) await runItem(ctx, i);
    const concluded = await ctx.runner.concludeIteratingStage(ctx.stage, {
      runId: ctx.created.id,
      stageExecutionId: ctx.execution.id,
    });
    expect(concluded.outcome).toBe('passed');
    expect((await executionRow(ctx.execution.id)).state).toBe('passed');
    expect(await openWaits(ctx.execution.id)).toHaveLength(0);
  });

  describe('an item QC gave up on', () => {
    async function withHeldItem() {
      const ctx = await setUp([shotsStage(['a', 'b', 'c']), brollStage({ qc: QC_FAILS })], 3);
      const plain = withoutQc(ctx.stage, ctx.effective);
      expect((await runItem(ctx, 0, plain)).result.outcome).toBe('success');
      const second = await runItem(ctx, 1);
      expect(second.result.outcome).toBe('qc_failed');
      // What the attempt loop does once QC's attempts are spent.
      const handedOff = await ctx.runner.handOffForReview(ctx.stage, second.attempt);
      expect(handedOff.outcome).toBe('approval_required');
      expect((await runItem(ctx, 2, plain)).result.outcome).toBe('success');
      return { ...ctx, heldAttemptId: second.attempt.stageAttemptId };
    }

    it('is held without pausing the stage, then reviewed once with the others, held first', async () => {
      const ctx = await withHeldItem();
      const items = await itemRows(ctx.execution.id);
      expect(items.map((i) => i.state)).toEqual(['passed', 'awaiting_approval', 'passed']);
      expect(await openWaits(ctx.execution.id)).toHaveLength(0);
      expect((await executionRow(ctx.execution.id)).state).not.toBe('awaiting_approval');

      const concluded = await ctx.runner.concludeIteratingStage(ctx.stage, {
        runId: ctx.created.id,
        stageExecutionId: ctx.execution.id,
      });
      expect(concluded.outcome).toBe('approval_required');
      const waits = await openWaits(ctx.execution.id);
      expect(waits).toHaveLength(1);
      expect(waits[0]?.stageItemId).toBeNull();

      await pauseForApproval(ctx.created.id);
      const review = await testApp.app.get(RunService).stageReview(ctx.created.id, 'broll');
      expect(review.items.map((i) => [i.itemIndex, i.held, i.heldReason])).toEqual([
        [1, true, 'qc_failed'],
        [0, false, null],
        [2, false, null],
      ]);
    });

    it('is accepted as it is when the whole stage is approved', async () => {
      const ctx = await withHeldItem();
      await ctx.runner.concludeIteratingStage(ctx.stage, {
        runId: ctx.created.id,
        stageExecutionId: ctx.execution.id,
      });
      await pauseForApproval(ctx.created.id);
      await testApp.app.get(HumanActionService).approve(ctx.created.id, 'broll');

      const items = await itemRows(ctx.execution.id);
      expect(items.map((i) => i.state)).toEqual(['passed', 'passed', 'passed']);
      const [held] = await testDb.db
        .select()
        .from(artifact)
        .where(eq(artifact.id, items[1]!.outputArtifactId!));
      expect(held?.stale).toBe(false);
      const finished = await executionRow(ctx.execution.id);
      expect(finished.state).toBe('passed');
      expect(finished.outputArtifactId).toBe(items[2]?.outputArtifactId);
      expect(await openWaits(ctx.execution.id)).toHaveLength(0);
    });

    it('is redone with every other item when the whole stage is rejected, with the note carried on one attempt', async () => {
      const ctx = await withHeldItem();
      await ctx.runner.concludeIteratingStage(ctx.stage, {
        runId: ctx.created.id,
        stageExecutionId: ctx.execution.id,
      });
      await pauseForApproval(ctx.created.id);
      const actions = testApp.app.get(HumanActionService);
      const previewed = await actions.reject(ctx.created.id, 'broll', 'make it brighter');
      if (!('previewToken' in previewed)) throw new Error('expected a preview');
      await actions.reject(ctx.created.id, 'broll', 'make it brighter', previewed.previewToken);

      const [rejected] = await testDb.db
        .select()
        .from(stageAttempt)
        .where(eq(stageAttempt.id, ctx.heldAttemptId));
      expect(rejected?.outcome).toBe('rejected');
      expect(rejected?.reviewNote).toBe('make it brighter');
      expect(rejected?.critiqueTargetStageKey).toBe('broll');
      expect((await itemRows(ctx.execution.id)).map((i) => i.state)).toEqual([
        'stale',
        'stale',
        'stale',
      ]);
      expect((await executionRow(ctx.execution.id)).state).toBe('stale');
      expect(await openWaits(ctx.execution.id)).toHaveLength(0);
    });
  });

  it("'Retry QC' sends every item QC could not judge back to be judged, and keeps the review for the rest", async () => {
    const ctx = await setUp([shotsStage(['a', 'b']), brollStage({ qc: QC_UNAVAILABLE })], 2);
    const plain = withoutQc(ctx.stage, ctx.effective);
    await runItem(ctx, 0, plain);
    const held = await runItem(ctx, 1);
    expect(held.result.outcome).toBe('approval_required');

    await ctx.runner.concludeIteratingStage(ctx.stage, {
      runId: ctx.created.id,
      stageExecutionId: ctx.execution.id,
    });
    await pauseForApproval(ctx.created.id);
    const review = await testApp.app.get(RunService).stageReview(ctx.created.id, 'broll');
    expect(review.items[0]).toMatchObject({ itemIndex: 1, held: true, heldReason: 'qc_error' });
    expect(review.items[0]?.attempt?.qcUnavailable).toContain('transport');

    await testApp.app.get(HumanActionService).retryQc(ctx.created.id, 'broll');

    const [attempt] = await testDb.db
      .select()
      .from(stageAttempt)
      .where(eq(stageAttempt.id, held.attempt.stageAttemptId));
    expect(attempt?.phase).toBe('settled');
    expect((await itemRows(ctx.execution.id)).map((i) => i.state)).toEqual(['passed', 'running']);
    expect((await executionRow(ctx.execution.id)).state).toBe('running');
    expect(await openWaits(ctx.execution.id)).toHaveLength(0);
  });

  it("an item-mode review still loads a QC hold ('Retry QC' needs the candidate)", async () => {
    const ctx = await setUp(
      [shotsStage(['a']), brollStage({ approval: { mode: 'item' }, qc: QC_UNAVAILABLE })],
      1,
    );
    const held = await runItem(ctx, 0);
    expect(held.result.outcome).toBe('approval_required');
    await pauseForApproval(ctx.created.id);

    const candidate = await testApp.app.get(RunService).approvalCandidate(ctx.created.id, 'broll');
    expect(candidate.itemIndex).toBe(0);
    expect(candidate.attempt.qcUnavailable).toContain('transport');
  });
});

/**
 * `stage.execute`'s real outer loop, with `run-item-*` run through the real
 * `stage.execute.item` in a nested engine (see stage-execute-item-inngest's
 * note on why `step.invoke` can't resolve in-process).
 */
describe("stage.execute's outer loop with an end-of-stage review (real Inngest steps, e2e)", () => {
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
      name: `Stage Review Outer ${Date.now()} ${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Stage Review Outer');
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

  async function executeStage(created: Awaited<ReturnType<typeof setUp>>, itemCount: number) {
    const execution = created.stageExecutions.find((e) => e.stageKey === 'broll')!;
    const runner = testApp.app.get(StageRunnerService);
    const itemSteps = Array.from({ length: itemCount }, (_, i) => ({
      id: `run-item-${i}`,
      handler: async () => {
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
    return { ...(await engine.execute()), execution };
  }

  async function waitsOf(executionId: string) {
    return testDb.db
      .select()
      .from(humanWait)
      .where(and(eq(humanWait.stageExecutionId, executionId), isNull(humanWait.resolvedAt)));
  }

  it('runs every item even when QC gives up on all of them, then opens exactly one review', async () => {
    const created = await setUp([shotsStage(['a', 'b', 'c']), brollStage({ qc: QC_FAILS })]);
    const { result, error, execution } = await executeStage(created, 3);
    expect(error).toBeUndefined();
    expect(result).toMatchObject({ outcome: 'approval_required' });

    const items = await testDb.db
      .select()
      .from(stageItem)
      .where(eq(stageItem.stageExecutionId, execution.id));
    expect(items.map((i) => i.state)).toEqual([
      'awaiting_approval',
      'awaiting_approval',
      'awaiting_approval',
    ]);
    const waits = await waitsOf(execution.id);
    expect(waits).toHaveLength(1);
    expect(waits[0]?.stageItemId).toBeNull();
    const [row] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, execution.id));
    expect(row?.state).toBe('awaiting_approval');
  });

  it("approval mode 'stage' reviews once after the last item, not between items", async () => {
    const created = await setUp([
      shotsStage(['a', 'b']),
      brollStage({ approval: { mode: 'stage' } }),
    ]);
    const { result, error, execution } = await executeStage(created, 2);
    expect(error).toBeUndefined();
    expect(result).toMatchObject({ outcome: 'approval_required' });
    const items = await testDb.db
      .select()
      .from(stageItem)
      .where(eq(stageItem.stageExecutionId, execution.id));
    expect(items.map((i) => i.state)).toEqual(['passed', 'passed']);
    expect(await waitsOf(execution.id)).toHaveLength(1);
  });

  it('a stage with no approval and no QC problem passes without pausing', async () => {
    const created = await setUp([shotsStage(['a', 'b']), brollStage()]);
    const { result, error, execution } = await executeStage(created, 2);
    expect(error).toBeUndefined();
    expect(result).toMatchObject({ outcome: 'passed' });
    expect(await waitsOf(execution.id)).toHaveLength(0);
    const [row] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, execution.id));
    expect(row?.state).toBe('passed');
  });
});
