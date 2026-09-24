import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import type { InputDef, StageDef } from '@reefcraft/shared';
import type { EffectiveStageConfig } from '../../src/run-config/config-resolver.service';
import type { FetchAndFinalizeResult } from '../../src/orchestration/stage-runner.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { ChannelService } from '../../src/channel/channel.service';
import { RunService } from '../../src/run/run.service';
import { HumanActionService } from '../../src/run/human-action.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { toUsd } from '../../src/common/money';
import {
  humanWait,
  ledgerEntry,
  run,
  stageAttempt,
  stageExecution,
  stageItem,
} from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

/**
 * Phase 7 chunk 6 — `approval.mode: 'item'` wired end to end. Driven
 * directly through `StageRunnerService`/`HumanActionService` (no Inngest),
 * mirroring `phase7-iteration.e2e.test.ts`'s (Chunk 4) and
 * `phase4-actions.e2e.test.ts`'s (stage-mode approval) established style.
 */
describe('phase 7 chunk 6 — item-mode approval (e2e)', () => {
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

  /** An earlier, non-iterating planning stage — used as a routed rejection
   * target. Deliberately independent of `broll`'s own dependency chain: the
   * point of the routed-rejection test is that the invalidation SEED forces
   * it invalid regardless of structural dependency, the same way
   * `forcedStageKeys` does for stage-mode. */
  function styleStage(): StageDef {
    return {
      key: 'style',
      label: 'Style',
      capability: 'text.generate',
      config: {},
      slots: {},
      context: {},
      output: { kind: 'text' },
      checks: [],
      retryLimit: 5,
      model: {
        provider: 'fake',
        modelId: 'fake-text-1',
        params: { max_tokens: 64, fakeOutput: 'moody' },
      },
    };
  }

  function brollStage(
    itemRetryLimit: number,
    overrides: Partial<Pick<StageDef, 'approval'>> = {},
  ): StageDef {
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
        itemRetryLimit,
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
      approval: { mode: 'item' },
      model: {
        provider: 'fake',
        modelId: 'fake-text-1',
        params: { max_tokens: 64, fakeOutput: { caption: 'ok' } },
      },
      ...overrides,
    };
  }

  const FORCE_FAIL_INPUT: InputDef = {
    key: 'forceFail',
    label: 'Force fail',
    required: false,
    accepts: { kind: 'text' },
  };

  async function createRun(graph: StageDef[]) {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);
    const channel = await channels.create('local', {
      name: `Phase 7 Item Approval ${Date.now()} ${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Phase 7 Item Approval');
    const version = await blueprints.createVersion(blueprintId, {
      graph,
      inputs: [FORCE_FAIL_INPUT],
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
    await testDb.db.update(run).set({ state: 'RUNNING' }).where(eq(run.id, created.id));
    return created;
  }

  /** Drives a plain (non-iterating) stage's single attempt to completion. */
  async function passStage(runner: StageRunnerService, runId: string, stageKey: string) {
    const { stage, effective, prevStageKey } = await runner.loadStageContext(runId, stageKey);
    const [row] = await testDb.db
      .select()
      .from(stageExecution)
      .where(and(eq(stageExecution.runId, runId), eq(stageExecution.stageKey, stageKey)));
    const attempt = await runner.beginAttempt({
      runId,
      stageExecutionId: row!.id,
      stageKey,
    });
    const submitted = await runner.reserveAndSubmit(stage, attempt, prevStageKey, effective);
    if (submitted.outcome !== 'submitted')
      throw new Error(`unexpected submit: ${submitted.outcome}`);
    const result = await runner.fetchAndFinalize(
      stage,
      attempt,
      submitted.handle,
      prevStageKey,
      effective,
    );
    if (result.outcome !== 'success') throw new Error(`unexpected fetch: ${result.outcome}`);
  }

  /** Sets up `broll` (with N items resolved from `shots`) ready for the
   * per-item loop, returning everything a test needs to drive it further. */
  async function setUpBroll(graph: StageDef[]) {
    const created = await createRun(graph);
    const runner = testApp.app.get(StageRunnerService);
    await passStage(runner, created.id, 'shots');
    if (graph.some((s) => s.key === 'style')) {
      await passStage(runner, created.id, 'style');
    }
    const brollExecution = created.stageExecutions.find((e) => e.stageKey === 'broll')!;
    const { stage, effective, prevStageKey } = await runner.loadStageContext(created.id, 'broll');
    const resolved = await runner.resolveIterateCount(
      created.id,
      brollExecution.id,
      stage,
      effective,
      prevStageKey,
    );
    if (!resolved.ok) throw new Error(`unexpected resolveIterateCount: ${resolved.reason}`);
    await runner.ensureStageItems(brollExecution.id, resolved.itemCount);
    return { created, runner, brollExecution, stage, effective, prevStageKey };
  }

  /** One item's single attempt (no retry loop — these tests don't force
   * check failures), returning the raw `fetchAndFinalize` result so the
   * caller can assert on `'approval_required'` directly. */
  async function runOneItemAttempt(
    runner: StageRunnerService,
    runId: string,
    executionId: string,
    stage: StageDef,
    effective: EffectiveStageConfig,
    prevStageKey: string | undefined,
    itemIndex: number,
    stageItemId: string,
  ): Promise<FetchAndFinalizeResult> {
    const attemptCtx = await runner.beginAttempt({
      runId,
      stageExecutionId: executionId,
      stageKey: stage.key,
      itemIndex,
      stageItemId,
    });
    const submitted = await runner.reserveAndSubmit(stage, attemptCtx, prevStageKey, effective);
    if (submitted.outcome !== 'submitted') {
      throw new Error(`unexpected submit outcome: ${submitted.outcome}`);
    }
    return runner.fetchAndFinalize(stage, attemptCtx, submitted.handle, prevStageKey, effective);
  }

  /** Mirrors `stage.execute`'s outer per-item loop: skip already-passed
   * items, run the next one, and stop (without invoking `finishIteratingStage`)
   * the moment an item pauses for approval or fails — the same "bubble the
   * outcome" shape `stage.execute`'s real outer loop already has. */
  async function driveUntilPauseOrDone(
    runner: StageRunnerService,
    runId: string,
    executionId: string,
    stage: StageDef,
    effective: EffectiveStageConfig,
    prevStageKey: string | undefined,
    itemCount: number,
  ): Promise<
    | { outcome: 'passed'; artifactId: string }
    | { outcome: 'approval_required'; itemIndex: number }
    | { outcome: 'failed' }
  > {
    for (let i = 0; i < itemCount; i += 1) {
      const item = await runner.itemState(executionId, i);
      if (item.state === 'passed') continue;
      const result = await runOneItemAttempt(
        runner,
        runId,
        executionId,
        stage,
        effective,
        prevStageKey,
        i,
        item.id,
      );
      if (result.outcome === 'approval_required')
        return { outcome: 'approval_required', itemIndex: i };
      if (result.outcome !== 'success') return { outcome: 'failed' };
    }
    const finished = await runner.finishIteratingStage(executionId);
    return { outcome: 'passed', artifactId: finished.artifactId };
  }

  async function pauseRunForApproval(runId: string, stageKey: string) {
    await testDb.db
      .update(run)
      .set({ state: 'PAUSED_APPROVAL', cursorStageKey: stageKey })
      .where(eq(run.id, runId));
  }

  /** `HumanActionService.approve`/`.reject` only enqueue a `run/resumed`
   * wakeup row — flipping `run.state` back to `RUNNING` is normally done by
   * the Inngest-driven wakeup consumer, which isn't running in this
   * no-Inngest e2e style. Set it directly, exactly like `createRun` sets
   * the initial `RUNNING` state by hand. */
  async function resumeRunning(runId: string) {
    await testDb.db.update(run).set({ state: 'RUNNING' }).where(eq(run.id, runId));
  }

  async function attemptsFor(stageItemId: string) {
    return testDb.db.select().from(stageAttempt).where(eq(stageAttempt.stageItemId, stageItemId));
  }

  it('pauses after item 0 checks pass, before item 1 ever submits, and at-risk cost reflects only item 0', async () => {
    const graph = [shotsStage(['ok0', 'ok1', 'ok2', 'ok3']), brollStage(0)];
    const { created, runner, brollExecution, stage, effective, prevStageKey } =
      await setUpBroll(graph);

    const item0 = await runner.itemState(brollExecution.id, 0);
    const result = await runOneItemAttempt(
      runner,
      created.id,
      brollExecution.id,
      stage,
      effective,
      prevStageKey,
      0,
      item0.id,
    );
    expect(result.outcome).toBe('approval_required');

    const [item0Row] = await testDb.db.select().from(stageItem).where(eq(stageItem.id, item0.id));
    expect(item0Row?.state).toBe('awaiting_approval');

    // Item 1 was never even attempted — no stage_attempt row at all.
    const item1 = await runner.itemState(brollExecution.id, 1);
    expect(await attemptsFor(item1.id)).toHaveLength(0);

    // The stage_execution itself is left alone (still not 'awaiting_approval'
    // or 'passed' — the pause is scoped to the item, not the whole stage).
    const [executionRow] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, brollExecution.id));
    expect(executionRow?.state).not.toBe('awaiting_approval');
    expect(executionRow?.state).not.toBe('passed');

    // The human_wait row is scoped to item 0, not the execution as a whole.
    const openWaits = await testDb.db
      .select()
      .from(humanWait)
      .where(and(eq(humanWait.stageExecutionId, brollExecution.id), isNull(humanWait.resolvedAt)));
    expect(openWaits).toHaveLength(1);
    expect(openWaits[0]?.stageItemId).toBe(item0.id);
    expect(openWaits[0]?.kind).toBe('approval');

    // Cost containment (§25.1's motivating claim): the ledger's confirmed
    // spend for `broll` at the pause point is EXACTLY item 0's own cost —
    // items 1-3 never spent a cent because they never submitted.
    const actualEntries = await testDb.db
      .select()
      .from(ledgerEntry)
      .where(
        and(
          eq(ledgerEntry.runId, created.id),
          eq(ledgerEntry.stageKey, 'broll'),
          eq(ledgerEntry.kind, 'actual'),
        ),
      );
    const totalActual = actualEntries.reduce((sum, row) => sum + toUsd(row.amountUsd), 0);
    const [item0Attempt] = await attemptsFor(item0.id);
    expect(totalActual).toBeGreaterThan(0);
    expect(totalActual).toBeCloseTo(toUsd(item0Attempt!.costUsd), 6);
  });

  it('approving item 0 (with itemIndex omitted) resumes exactly at item 1', async () => {
    const graph = [shotsStage(['ok0', 'ok1', 'ok2', 'ok3']), brollStage(0)];
    const { created, runner, brollExecution, stage, effective, prevStageKey } =
      await setUpBroll(graph);

    const paused = await driveUntilPauseOrDone(
      runner,
      created.id,
      brollExecution.id,
      stage,
      effective,
      prevStageKey,
      4,
    );
    expect(paused).toEqual({ outcome: 'approval_required', itemIndex: 0 });

    await pauseRunForApproval(created.id, 'broll');
    await testApp.app.get(HumanActionService).approve(created.id, 'broll');

    const item0 = await runner.itemState(brollExecution.id, 0);
    expect(item0.state).toBe('passed');
    const [item0Row] = await testDb.db.select().from(stageItem).where(eq(stageItem.id, item0.id));
    expect(item0Row?.outputArtifactId).toBeTruthy();
    expect(Number(item0Row?.attemptCount)).toBe(1);

    // stage_execution stays exactly as it was — more items remain.
    const [executionAfterApprove] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, brollExecution.id));
    expect(executionAfterApprove?.state).not.toBe('passed');

    // The open wait is resolved.
    expect(
      await testDb.db
        .select()
        .from(humanWait)
        .where(
          and(eq(humanWait.stageExecutionId, brollExecution.id), isNull(humanWait.resolvedAt)),
        ),
    ).toHaveLength(0);

    // Driving the loop forward (as `stage.execute`'s outer loop would on a
    // resumed run) skips the now-'passed' item 0 and submits item 1 for
    // real — proving forward progress, not a stall or a re-run of item 0.
    await resumeRunning(created.id);
    const resumed = await driveUntilPauseOrDone(
      runner,
      created.id,
      brollExecution.id,
      stage,
      effective,
      prevStageKey,
      4,
    );
    expect(resumed).toEqual({ outcome: 'approval_required', itemIndex: 1 });
    const item1 = await runner.itemState(brollExecution.id, 1);
    expect(item1.state).toBe('awaiting_approval');
    expect(await attemptsFor(item1.id)).toHaveLength(1);
    // Item 0 was not re-invoked by resuming.
    expect(await attemptsFor(item0.id)).toHaveLength(1);
  });

  it('rejecting item 0 (default retry target) re-submits item 0 only, leaving item 1 untouched', async () => {
    const graph = [shotsStage(['ok0', 'ok1', 'ok2', 'ok3']), brollStage(1)];
    const { created, runner, brollExecution, stage, effective, prevStageKey } =
      await setUpBroll(graph);

    const paused = await driveUntilPauseOrDone(
      runner,
      created.id,
      brollExecution.id,
      stage,
      effective,
      prevStageKey,
      4,
    );
    expect(paused).toEqual({ outcome: 'approval_required', itemIndex: 0 });
    const item0 = await runner.itemState(brollExecution.id, 0);
    const item1 = await runner.itemState(brollExecution.id, 1);

    await pauseRunForApproval(created.id, 'broll');
    const humanActions = testApp.app.get(HumanActionService);
    const preview = await humanActions.reject(created.id, 'broll', 'try again');
    expect('previewToken' in preview).toBe(true);
    const confirmed = await humanActions.reject(
      created.id,
      'broll',
      'try again',
      (preview as { previewToken: string }).previewToken,
    );
    expect(confirmed).toMatchObject({ accepted: true, state: 'PENDING' });

    // Item 0 goes stale (invalidated), ready to be re-run.
    const item0AfterReject = await testDb.db
      .select()
      .from(stageItem)
      .where(eq(stageItem.id, item0.id));
    expect(item0AfterReject[0]?.state).toBe('stale');
    expect(item0AfterReject[0]?.outputArtifactId).toBeNull();
    // Item 1 (never run) is completely untouched.
    const item1AfterReject = await testDb.db
      .select()
      .from(stageItem)
      .where(eq(stageItem.id, item1.id));
    expect(item1AfterReject[0]?.state).toBe('pending');
    expect(await attemptsFor(item1.id)).toHaveLength(0);

    // Re-driving the loop re-submits item 0 — a NEW stage_attempt row, same
    // stageItemId — and item 0 passes on the (fresh) attempt since nothing
    // about the fixture actually made it fail.
    await resumeRunning(created.id);
    const resumed = await driveUntilPauseOrDone(
      runner,
      created.id,
      brollExecution.id,
      stage,
      effective,
      prevStageKey,
      4,
    );
    expect(resumed).toEqual({ outcome: 'approval_required', itemIndex: 0 });
    const item0Attempts = await attemptsFor(item0.id);
    expect(item0Attempts).toHaveLength(2);
    expect(item0Attempts.map((a) => a.attemptNo).sort()).toEqual([1, 2]);
    expect(await attemptsFor(item1.id)).toHaveLength(0);
  });

  it('a routed rejection (onReject.retryStageKey pointing at an earlier non-iterating stage) seeds invalidation there without touching sibling items', async () => {
    const graph = [
      styleStage(),
      shotsStage(['ok0', 'ok1', 'ok2', 'ok3']),
      brollStage(1, { approval: { mode: 'item', onReject: { retryStageKey: 'style' } } }),
    ];
    const { created, runner, brollExecution, stage, effective, prevStageKey } =
      await setUpBroll(graph);

    const paused = await driveUntilPauseOrDone(
      runner,
      created.id,
      brollExecution.id,
      stage,
      effective,
      prevStageKey,
      4,
    );
    expect(paused).toEqual({ outcome: 'approval_required', itemIndex: 0 });
    const item0 = await runner.itemState(brollExecution.id, 0);
    const item1 = await runner.itemState(brollExecution.id, 1);

    await pauseRunForApproval(created.id, 'broll');
    const humanActions = testApp.app.get(HumanActionService);
    const preview = await humanActions.reject(created.id, 'broll', 'wrong style');
    const confirmed = await humanActions.reject(
      created.id,
      'broll',
      'wrong style',
      (preview as { previewToken: string }).previewToken,
    );
    expect(confirmed).toMatchObject({ accepted: true, state: 'PENDING' });

    // `style` (the routed target) is invalidated as a whole stage.
    const [styleExecution] = await testDb.db
      .select()
      .from(stageExecution)
      .where(and(eq(stageExecution.runId, created.id), eq(stageExecution.stageKey, 'style')));
    expect(styleExecution?.state).toBe('stale');

    // The rejected item itself is also invalidated (forced, mirroring
    // stage-mode's `forcedStageKeys`), even though `style` doesn't
    // structurally depend on it.
    const item0AfterReject = await testDb.db
      .select()
      .from(stageItem)
      .where(eq(stageItem.id, item0.id));
    expect(item0AfterReject[0]?.state).toBe('stale');

    // Sibling item 1 (never run) is untouched — no artifact to discard.
    const item1AfterReject = await testDb.db
      .select()
      .from(stageItem)
      .where(eq(stageItem.id, item1.id));
    expect(item1AfterReject[0]?.state).toBe('pending');
    expect(await attemptsFor(item1.id)).toHaveLength(0);

    const [runAfter] = await testDb.db.select().from(run).where(eq(run.id, created.id));
    expect(runAfter?.cursorStageKey).toBe('style');
  });
});
