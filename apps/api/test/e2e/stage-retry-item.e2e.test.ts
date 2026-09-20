import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { InputDef, StageDef } from '@reefcraft/shared';
import type { EffectiveStageConfig } from '../../src/run-config/config-resolver.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { ChannelService } from '../../src/channel/channel.service';
import { RunService } from '../../src/run/run.service';
import { RunActionService } from '../../src/run/run-action.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { run, stageAttempt, stageExecution, stageItem } from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

/**
 * Phase 7 MEDIUM finding #3 (PR #17 review) — `RunActionService`'s
 * `previewInvalidation`/`previewStageRetry`/`confirmStageRetry` now accept
 * an `itemIndex`, item-scoping a stage retry to one `stage_item` instead of
 * the whole stage. Driven directly through `RunActionService`/
 * `StageRunnerService` (no Inngest), mirroring
 * `item-approval.e2e.test.ts`'s (Chunk 6) established style for this
 * codebase's no-Inngest e2e suites.
 */
describe('phase 7 MEDIUM #3 — item-scoped stage retry preview/confirm (e2e)', () => {
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

  /** No approval — the retry itself is what's under test, not approval. */
  function brollStage(itemRetryLimit: number): StageDef {
    return {
      key: 'broll',
      label: 'B-roll',
      capability: 'llm.generate',
      config: {},
      slots: { shot: { from: 'item' } },
      context: {},
      iterate: { over: { from: 'prev' }, itemAlias: 'shot', itemRetryLimit },
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
      name: `Phase 7 Item Retry ${Date.now()} ${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Phase 7 Item Retry');
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

  async function passStage(runner: StageRunnerService, runId: string, stageKey: string) {
    const { stage, effective, prevStageKey } = await runner.loadStageContext(runId, stageKey);
    const [row] = await testDb.db
      .select()
      .from(stageExecution)
      .where(and(eq(stageExecution.runId, runId), eq(stageExecution.stageKey, stageKey)));
    const attempt = await runner.beginAttempt({ runId, stageExecutionId: row!.id, stageKey });
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

  async function setUpBroll(graph: StageDef[]) {
    const created = await createRun(graph);
    const runner = testApp.app.get(StageRunnerService);
    await passStage(runner, created.id, 'shots');
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

  async function runOneItemAttempt(
    runner: StageRunnerService,
    runId: string,
    executionId: string,
    stage: StageDef,
    effective: EffectiveStageConfig,
    prevStageKey: string | undefined,
    itemIndex: number,
    stageItemId: string,
  ) {
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
    const result = await runner.fetchAndFinalize(
      stage,
      attemptCtx,
      submitted.handle,
      prevStageKey,
      effective,
    );
    if (result.outcome !== 'success') throw new Error(`unexpected fetch: ${result.outcome}`);
  }

  /** Drives every pending item of an iterating stage to 'passed', then
   * `finishIteratingStage`. No retry loop — these tests never force a
   * failure. */
  async function driveAllItemsToPassed(
    runner: StageRunnerService,
    runId: string,
    executionId: string,
    stage: StageDef,
    effective: EffectiveStageConfig,
    prevStageKey: string | undefined,
    itemCount: number,
  ) {
    for (let i = 0; i < itemCount; i += 1) {
      const item = await runner.itemState(executionId, i);
      if (item.state === 'passed') continue;
      await runOneItemAttempt(
        runner,
        runId,
        executionId,
        stage,
        effective,
        prevStageKey,
        i,
        item.id,
      );
    }
    await runner.finishIteratingStage(executionId);
  }

  async function itemRows(executionId: string) {
    return testDb.db
      .select()
      .from(stageItem)
      .where(eq(stageItem.stageExecutionId, executionId))
      .orderBy(stageItem.itemIndex);
  }

  async function attemptsFor(stageItemId: string) {
    return testDb.db.select().from(stageAttempt).where(eq(stageAttempt.stageItemId, stageItemId));
  }

  /** `confirmStageRetry` only enqueues a `run/resumed` wakeup row — flipping
   * `run.state` back to `RUNNING` is normally done by the Inngest-driven
   * wakeup consumer, which isn't running in this no-Inngest e2e style
   * (mirrors `item-approval.e2e.test.ts`'s own `resumeRunning` helper). */
  async function resumeRunning(runId: string) {
    await testDb.db.update(run).set({ state: 'RUNNING' }).where(eq(run.id, runId));
  }

  it('previews and confirms a retry scoped to one item: only that item goes stale and gets a fresh attempt, siblings are untouched', async () => {
    const graph = [shotsStage(['ok0', 'ok1', 'ok2', 'ok3']), brollStage(0)];
    const { created, runner, brollExecution, stage, effective, prevStageKey } =
      await setUpBroll(graph);
    await driveAllItemsToPassed(
      runner,
      created.id,
      brollExecution.id,
      stage,
      effective,
      prevStageKey,
      4,
    );

    const itemsBefore = await itemRows(brollExecution.id);
    expect(itemsBefore.map((row) => row.state)).toEqual(['passed', 'passed', 'passed', 'passed']);
    const artifactsBefore = itemsBefore.map((row) => row.outputArtifactId);
    expect(artifactsBefore.every((id) => id !== null)).toBe(true);

    // A completed run is one of the states `retry` allows.
    await testDb.db.update(run).set({ state: 'COMPLETED' }).where(eq(run.id, created.id));

    const actions = testApp.app.get(RunActionService);
    const preview = await actions.previewStageRetry(created.id, 'broll', 1);
    expect(preview.previewToken).toBeTruthy();
    expect(preview.affected.map((a) => a.stageKey)).toEqual(['broll']);

    const confirmed = await actions.confirmStageRetry(created.id, 'broll', preview.previewToken, 1);
    expect(confirmed.accepted).toBe(true);

    const itemsAfter = await itemRows(brollExecution.id);
    expect(itemsAfter.map((row) => row.state)).toEqual(['passed', 'stale', 'passed', 'passed']);
    expect(itemsAfter[1]?.outputArtifactId).toBeNull();
    // Siblings' artifacts are byte-for-byte untouched.
    expect(itemsAfter[0]?.outputArtifactId).toBe(artifactsBefore[0]);
    expect(itemsAfter[2]?.outputArtifactId).toBe(artifactsBefore[2]);
    expect(itemsAfter[3]?.outputArtifactId).toBe(artifactsBefore[3]);
    // Sibling attempt counts are untouched — no new attempts for them.
    expect(await attemptsFor(itemsBefore[0]!.id)).toHaveLength(1);
    expect(await attemptsFor(itemsBefore[2]!.id)).toHaveLength(1);
    expect(await attemptsFor(itemsBefore[3]!.id)).toHaveLength(1);

    // The staled item can genuinely be re-run: a fresh attempt succeeds and
    // leaves a NEW stage_attempt row (attempt_no continues, never resets).
    await resumeRunning(created.id);
    await runOneItemAttempt(
      runner,
      created.id,
      brollExecution.id,
      stage,
      effective,
      prevStageKey,
      1,
      itemsAfter[1]!.id,
    );
    const item1AttemptsAfterRetry = await attemptsFor(itemsAfter[1]!.id);
    expect(item1AttemptsAfterRetry).toHaveLength(2);
    expect(item1AttemptsAfterRetry.map((a) => a.attemptNo).sort()).toEqual([1, 2]);
    const item1Final = await runner.itemState(brollExecution.id, 1);
    expect(item1Final.state).toBe('passed');
  });

  it('rejects confirming a preview token issued for one itemIndex against a different itemIndex or no itemIndex at all (token-scoping regression)', async () => {
    const graph = [shotsStage(['ok0', 'ok1']), brollStage(0)];
    const { created, runner, brollExecution, stage, effective, prevStageKey } =
      await setUpBroll(graph);
    await driveAllItemsToPassed(
      runner,
      created.id,
      brollExecution.id,
      stage,
      effective,
      prevStageKey,
      2,
    );

    await testDb.db.update(run).set({ state: 'COMPLETED' }).where(eq(run.id, created.id));

    const actions = testApp.app.get(RunActionService);
    // A preview token scoped to item 0 ONLY.
    const previewForItem0 = await actions.previewStageRetry(created.id, 'broll', 0);

    const itemsBeforeAttack = await itemRows(brollExecution.id);
    expect(itemsBeforeAttack.map((row) => row.state)).toEqual(['passed', 'passed']);

    // Confirming against a DIFFERENT itemIndex must be rejected as a
    // preview/token mismatch, never silently applied to item 1 instead.
    await expect(
      actions.confirmStageRetry(created.id, 'broll', previewForItem0.previewToken, 1),
    ).rejects.toThrow();

    // Confirming with itemIndex omitted entirely (falling back to the
    // whole-stage payload shape) must also be rejected, not silently
    // widened into a whole-stage retry.
    await expect(
      actions.confirmStageRetry(created.id, 'broll', previewForItem0.previewToken),
    ).rejects.toThrow();

    // Neither rejected attempt mutated anything — both items are exactly as
    // they were before the attack.
    const itemsAfterAttack = await itemRows(brollExecution.id);
    expect(itemsAfterAttack.map((row) => row.state)).toEqual(['passed', 'passed']);
    expect(itemsAfterAttack[0]?.outputArtifactId).toBe(itemsBeforeAttack[0]!.outputArtifactId);
    expect(itemsAfterAttack[1]?.outputArtifactId).toBe(itemsBeforeAttack[1]!.outputArtifactId);

    // The legitimate confirmation (matching itemIndex 0) still works.
    const confirmed = await actions.confirmStageRetry(
      created.id,
      'broll',
      previewForItem0.previewToken,
      0,
    );
    expect(confirmed.accepted).toBe(true);
    const itemsAfterLegitimateConfirm = await itemRows(brollExecution.id);
    expect(itemsAfterLegitimateConfirm.map((row) => row.state)).toEqual(['stale', 'passed']);
  });

  describe('previewStageRetry / previewInvalidation validation', () => {
    it('throws for a non-iterating stage given an itemIndex', async () => {
      const graph = [shotsStage(['ok0', 'ok1'])];
      const created = await createRun(graph);
      const actions = testApp.app.get(RunActionService);
      await expect(actions.previewStageRetry(created.id, 'shots', 0)).rejects.toThrow(
        /does not iterate/,
      );
      await expect(actions.previewInvalidation(created.id, 'shots', 0)).rejects.toThrow(
        /does not iterate/,
      );
    });

    it('throws for a nonexistent item index on an iterating stage', async () => {
      const graph = [shotsStage(['ok0', 'ok1', 'ok2', 'ok3']), brollStage(0)];
      const { created, runner, brollExecution, stage, effective, prevStageKey } =
        await setUpBroll(graph);
      await driveAllItemsToPassed(
        runner,
        created.id,
        brollExecution.id,
        stage,
        effective,
        prevStageKey,
        4,
      );
      const actions = testApp.app.get(RunActionService);
      await expect(actions.previewStageRetry(created.id, 'broll', 99)).rejects.toThrow(/not found/);
    });

    it('throws for an item that is still pending (not yet a valid retry target)', async () => {
      const graph = [shotsStage(['ok0', 'ok1']), brollStage(0)];
      const { created } = await setUpBroll(graph);
      // Items were created 'pending' by ensureStageItems above — none run yet.
      const actions = testApp.app.get(RunActionService);
      await expect(actions.previewStageRetry(created.id, 'broll', 0)).rejects.toThrow(
        /cannot be retried yet/,
      );
    });
  });
});
