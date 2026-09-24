import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { InputDef, StageDef } from '@reelcraft/shared';
import type { EffectiveStageConfig } from '../../src/run-config/config-resolver.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { ChannelService } from '../../src/channel/channel.service';
import { RunService } from '../../src/run/run.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { run, stageAttempt, stageExecution, stageItem } from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

/**
 * Phase 7 chunk 4 — the per-item loop, driven directly through
 * `StageRunnerService`'s new item-scoped methods (no Inngest involved),
 * mirroring `phase4-actions.e2e.test.ts`'s style: this suite is about
 * `StageRunnerService`'s own correctness (item creation, per-item attempts,
 * retry exhaustion, partial resume), not the Inngest wiring — that's
 * `stage-execute-item-inngest.e2e.test.ts`'s job.
 */
describe('phase 7 chunk 4 — iterating stage per-item loop (e2e)', () => {
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

  /** Forces a deterministic per-item failure via `run.inputs.forceFail`
   * (read live on every attempt, unlike the stage's own fixed
   * `fakeOutput`) rather than baking a sentinel into the `shots` array —
   * this lets the same blueprint model both "item 2 always fails" (phase
   * A) and "the failure is fixed, item 2 now passes" (phase B, partial
   * resume) just by updating `run.inputs` between phases. */
  function brollStage(itemRetryLimit: number, maxItems = 50): StageDef {
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
        maxItems,
      },
      output: {
        kind: 'data',
        schema: {
          type: 'object',
          properties: { caption: { type: 'string' } },
          required: ['caption'],
        },
      },
      checks: [
        {
          type: 'script',
          name: 'not_forced_to_fail',
          refs: { item: { from: 'item' }, forceFail: { from: 'input', inputKey: 'forceFail' } },
          code: `
            const shouldFail = refs.item.data === refs.forceFail.data;
            return { pass: !shouldFail, message: shouldFail ? 'forced item failure' : undefined };
          `,
        },
      ],
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

  async function createRun(graph: StageDef[], inputs: Record<string, unknown> = {}) {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);
    const channel = await channels.create('local', {
      name: `Phase 7 Iteration ${Date.now()} ${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Phase 7 Iteration');
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
      inputs,
      roleBindings: {},
      budgetCapUsd: 10,
    });
    await testDb.db.update(run).set({ state: 'RUNNING' }).where(eq(run.id, created.id));
    return created;
  }

  /** Runs `shots` (non-iterating) to completion so `broll`'s
   * `{from:'prev'}` iterate.over has something to resolve. */
  async function passShotsStage(runner: StageRunnerService, runId: string, executionId: string) {
    const { stage, effective, prevStageKey } = await runner.loadStageContext(runId, 'shots');
    const attempt = await runner.beginAttempt({
      runId,
      stageExecutionId: executionId,
      stageKey: 'shots',
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

  /** Drives one item's attempt loop directly (submit -> fetch, no polling —
   * the fake provider completes synchronously), retrying up to
   * `effective.iterate.itemRetryLimit` times, mirroring what
   * `runStageAttemptLoop` does inside `stage.execute.item` but without any
   * Inngest step machinery. */
  async function driveItemAttempts(
    runner: StageRunnerService,
    runId: string,
    executionId: string,
    stage: StageDef,
    effective: EffectiveStageConfig,
    prevStageKey: string | undefined,
    itemIndex: number,
    stageItemId: string,
  ) {
    const maxAttempts = effective.iterate!.itemRetryLimit + 1;
    for (let attemptNo = 1; attemptNo <= maxAttempts; attemptNo += 1) {
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
      if (result.outcome === 'success') return result;
      if (attemptNo === maxAttempts) {
        const reason = result.outcome === 'check_failed' ? 'check_failed' : result.outcome;
        await runner.failStageExecution(executionId, reason, stageItemId);
        return { outcome: 'failed' as const, reason };
      }
    }
    throw new Error('unreachable');
  }

  /** The outer per-item loop, as `stage.execute`'s iterate branch drives
   * it, minus the Inngest step boundaries. */
  async function driveIteratingLoop(
    runner: StageRunnerService,
    runId: string,
    executionId: string,
    stage: StageDef,
    effective: EffectiveStageConfig,
    prevStageKey: string | undefined,
    itemCount: number,
  ): Promise<{ outcome: 'passed'; artifactId: string } | { outcome: 'failed' }> {
    for (let i = 0; i < itemCount; i += 1) {
      const item = await runner.itemState(executionId, i);
      if (item.state === 'passed') continue;
      const result = await driveItemAttempts(
        runner,
        runId,
        executionId,
        stage,
        effective,
        prevStageKey,
        i,
        item.id,
      );
      if (result.outcome !== 'success') return { outcome: 'failed' };
    }
    const finished = await runner.finishIteratingStage(executionId);
    return { outcome: 'passed', artifactId: finished.artifactId };
  }

  it('creates pending stage_item rows, passes items in order with their own attempts/artifacts, exhausts itemRetryLimit on a forced failure, and partial-resumes without touching already-passed items', async () => {
    const graph = [shotsStage(['ok0', 'ok1', 'ok2', 'ok3']), brollStage(1)];
    const created = await createRun(graph, { forceFail: 'ok2' });
    const runner = testApp.app.get(StageRunnerService);
    const shotsExecution = created.stageExecutions.find((e) => e.stageKey === 'shots')!;
    const brollExecution = created.stageExecutions.find((e) => e.stageKey === 'broll')!;

    await passShotsStage(runner, created.id, shotsExecution.id);

    const { stage, effective, prevStageKey } = await runner.loadStageContext(created.id, 'broll');
    const resolved = await runner.resolveIterateCount(
      created.id,
      brollExecution.id,
      stage,
      effective,
      prevStageKey,
    );
    expect(resolved).toEqual({ ok: true, itemCount: 4 });
    if (!resolved.ok) throw new Error('expected ok');

    await runner.ensureStageItems(brollExecution.id, resolved.itemCount);

    const pendingItems = await testDb.db
      .select()
      .from(stageItem)
      .where(eq(stageItem.stageExecutionId, brollExecution.id))
      .orderBy(stageItem.itemIndex);
    expect(pendingItems).toHaveLength(4);
    expect(pendingItems.every((row) => row.state === 'pending')).toBe(true);

    const [executionRowAfterEnsure] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, brollExecution.id));
    expect(executionRowAfterEnsure?.isIterating).toBe(true);
    expect(executionRowAfterEnsure?.itemCount).toBe(4);

    // --- Phase A: item 2 is forced to fail and exhausts itemRetryLimit ---
    const firstPass = await driveIteratingLoop(
      runner,
      created.id,
      brollExecution.id,
      stage,
      effective,
      prevStageKey,
      resolved.itemCount,
    );
    expect(firstPass).toEqual({ outcome: 'failed' });

    const itemsAfterFailure = await testDb.db
      .select()
      .from(stageItem)
      .where(eq(stageItem.stageExecutionId, brollExecution.id))
      .orderBy(stageItem.itemIndex);
    expect(itemsAfterFailure.map((row) => row.state)).toEqual([
      'passed',
      'passed',
      'failed',
      'pending', // never attempted — no continue-and-isolate (§14.1)
    ]);
    expect(itemsAfterFailure[0]?.attemptCount).toBe(1);
    expect(itemsAfterFailure[1]?.attemptCount).toBe(1);
    const item0ArtifactBefore = itemsAfterFailure[0]!.outputArtifactId;
    const item1ArtifactBefore = itemsAfterFailure[1]!.outputArtifactId;
    expect(item0ArtifactBefore).toBeTruthy();
    expect(item1ArtifactBefore).toBeTruthy();

    const attemptsByItem = async (stageItemId: string) =>
      testDb.db.select().from(stageAttempt).where(eq(stageAttempt.stageItemId, stageItemId));

    expect(await attemptsByItem(itemsAfterFailure[0]!.id)).toHaveLength(1);
    expect(await attemptsByItem(itemsAfterFailure[1]!.id)).toHaveLength(1);
    // itemRetryLimit:1 -> 2 attempts, both check_failed.
    const item2AttemptsAfterFailure = await attemptsByItem(itemsAfterFailure[2]!.id);
    expect(item2AttemptsAfterFailure).toHaveLength(2);
    expect(item2AttemptsAfterFailure.every((row) => row.outcome === 'check_failed')).toBe(true);
    expect(await attemptsByItem(itemsAfterFailure[3]!.id)).toHaveLength(0);

    const [executionAfterFailure] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, brollExecution.id));
    // The outer loop bubbles the failure straight up without ever writing
    // to stage_execution itself — that stays whatever `stage.execute`'s
    // caller (run.orchestrate) decides.
    expect(executionAfterFailure?.state).not.toBe('passed');

    // --- "Fix" the underlying issue and partial-resume ---
    await testDb.db
      .update(run)
      .set({ inputs: { forceFail: '__none__' } })
      .where(eq(run.id, created.id));

    const secondPass = await driveIteratingLoop(
      runner,
      created.id,
      brollExecution.id,
      stage,
      effective,
      prevStageKey,
      resolved.itemCount,
    );
    expect(secondPass.outcome).toBe('passed');

    const itemsAfterResume = await testDb.db
      .select()
      .from(stageItem)
      .where(eq(stageItem.stageExecutionId, brollExecution.id))
      .orderBy(stageItem.itemIndex);
    expect(itemsAfterResume.map((row) => row.state)).toEqual([
      'passed',
      'passed',
      'passed',
      'passed',
    ]);

    // Items 0 and 1 were never re-invoked or recharged: same artifact, same
    // attemptCount, no new stage_attempt rows.
    expect(itemsAfterResume[0]?.outputArtifactId).toBe(item0ArtifactBefore);
    expect(itemsAfterResume[1]?.outputArtifactId).toBe(item1ArtifactBefore);
    expect(itemsAfterResume[0]?.attemptCount).toBe(1);
    expect(itemsAfterResume[1]?.attemptCount).toBe(1);
    expect(await attemptsByItem(itemsAfterResume[0]!.id)).toHaveLength(1);
    expect(await attemptsByItem(itemsAfterResume[1]!.id)).toHaveLength(1);

    // Item 2 got a third attempt (attempt_no continues, never resets) and
    // finally passed; item 3 ran for the first time and passed too.
    const item2AttemptsAfterResume = await attemptsByItem(itemsAfterResume[2]!.id);
    expect(item2AttemptsAfterResume.map((row) => row.attemptNo).sort()).toEqual([1, 2, 3]);
    expect(item2AttemptsAfterResume.find((row) => row.attemptNo === 3)?.outcome).toBe('success');
    expect(await attemptsByItem(itemsAfterResume[3]!.id)).toHaveLength(1);

    // finishIteratingStage: stage_execution passed, outputArtifactId is the
    // LAST item's artifact (Locked Decision 6 — a convenience pointer).
    const [executionAfterResume] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, brollExecution.id));
    expect(executionAfterResume?.state).toBe('passed');
    expect(executionAfterResume?.outputArtifactId).toBe(itemsAfterResume[3]!.outputArtifactId);
    expect(secondPass.outcome === 'passed' && secondPass.artifactId).toBe(
      itemsAfterResume[3]!.outputArtifactId,
    );
  });

  it('resolveIterateCount fails (does not throw) when the resolved array exceeds maxItems', async () => {
    const graph = [shotsStage(['a', 'b', 'c', 'd']), brollStage(0, 2)];
    const created = await createRun(graph, { forceFail: '__none__' });
    const runner = testApp.app.get(StageRunnerService);
    const shotsExecution = created.stageExecutions.find((e) => e.stageKey === 'shots')!;
    const brollExecution = created.stageExecutions.find((e) => e.stageKey === 'broll')!;

    await passShotsStage(runner, created.id, shotsExecution.id);

    const { stage, effective, prevStageKey } = await runner.loadStageContext(created.id, 'broll');
    const resolved = await runner.resolveIterateCount(
      created.id,
      brollExecution.id,
      stage,
      effective,
      prevStageKey,
    );
    expect(resolved).toEqual({ ok: false, reason: 'iterate_max_items_exceeded' });

    if (!resolved.ok) {
      await runner.failStageExecution(brollExecution.id, resolved.reason);
    }
    const [executionRow] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, brollExecution.id));
    expect(executionRow?.state).toBe('failed');
    expect((executionRow?.failure as { reason?: string } | null)?.reason).toBe(
      'iterate_max_items_exceeded',
    );

    // Never even created stage_item rows for a rejected item count.
    const items = await testDb.db
      .select()
      .from(stageItem)
      .where(eq(stageItem.stageExecutionId, brollExecution.id));
    expect(items).toHaveLength(0);
  });

  it('idempotencyKey varies by item so two items sharing an attemptNo never collide', async () => {
    const graph = [shotsStage(['x0', 'x1']), brollStage(0)];
    const created = await createRun(graph, { forceFail: '__none__' });
    const runner = testApp.app.get(StageRunnerService);
    const shotsExecution = created.stageExecutions.find((e) => e.stageKey === 'shots')!;
    const brollExecution = created.stageExecutions.find((e) => e.stageKey === 'broll')!;
    await passShotsStage(runner, created.id, shotsExecution.id);

    const { stage, effective, prevStageKey } = await runner.loadStageContext(created.id, 'broll');
    await runner.ensureStageItems(brollExecution.id, 2);
    const item0 = await runner.itemState(brollExecution.id, 0);
    const item1 = await runner.itemState(brollExecution.id, 1);

    await driveItemAttempts(
      runner,
      created.id,
      brollExecution.id,
      stage,
      effective,
      prevStageKey,
      0,
      item0.id,
    );
    await driveItemAttempts(
      runner,
      created.id,
      brollExecution.id,
      stage,
      effective,
      prevStageKey,
      1,
      item1.id,
    );

    const rows = await testDb.db
      .select({
        idempotencyKey: stageAttempt.idempotencyKey,
        stageItemId: stageAttempt.stageItemId,
      })
      .from(stageAttempt)
      .where(and(eq(stageAttempt.stageExecutionId, brollExecution.id)));
    expect(rows).toHaveLength(2);
    const keys = new Set(rows.map((row) => row.idempotencyKey));
    expect(keys.size).toBe(2); // item 0's attempt-1 key != item 1's attempt-1 key
  });

  // MEDIUM finding #2 (PR #17 review) — `ensureStageItems`'s self-consistency
  // guard against re-entering with a different `itemCount` than a prior call
  // recorded, without every existing `stage_item` row already being
  // `'stale'` (the state `InvalidationService.apply()` leaves them in after
  // retrying the array's own `iterate.over` source, per the HIGH-finding fix
  // in commit 076ce79). These tests exercise `ensureStageItems` directly,
  // marking rows `'stale'` by hand (mirroring what `apply()` would do)
  // rather than driving a full invalidation round-trip — the point here is
  // the guard's own logic, already covered end to end by
  // `invalidation-items.e2e.test.ts`.
  describe('ensureStageItems self-consistency guard (§15.2 MEDIUM #2)', () => {
    async function markAllItemsStale(executionId: string) {
      await testDb.db
        .update(stageItem)
        .set({ state: 'stale' })
        .where(eq(stageItem.stageExecutionId, executionId));
    }

    it('allows an itemCount change when every existing item is already stale, without deleting orphaned rows', async () => {
      const graph = [shotsStage(['a', 'b', 'c', 'd']), brollStage(0)];
      const created = await createRun(graph, { forceFail: '__none__' });
      const runner = testApp.app.get(StageRunnerService);
      const shotsExecution = created.stageExecutions.find((e) => e.stageKey === 'shots')!;
      const brollExecution = created.stageExecutions.find((e) => e.stageKey === 'broll')!;
      await passShotsStage(runner, created.id, shotsExecution.id);

      await runner.ensureStageItems(brollExecution.id, 4);
      await markAllItemsStale(brollExecution.id);

      // The array shrank to 2 on re-resolution (e.g. the producer's retried
      // output is a shorter array) — every existing item is 'stale', so the
      // guard must let this through.
      await expect(runner.ensureStageItems(brollExecution.id, 2)).resolves.toBeUndefined();

      const [execAfterShrink] = await testDb.db
        .select()
        .from(stageExecution)
        .where(eq(stageExecution.id, brollExecution.id));
      expect(execAfterShrink?.itemCount).toBe(2);

      // Trailing rows (index 2, 3) are left in the DB untouched — never
      // deleted (no cascade from stage_attempt.stage_item_id).
      const itemsAfterShrink = await testDb.db
        .select()
        .from(stageItem)
        .where(eq(stageItem.stageExecutionId, brollExecution.id))
        .orderBy(stageItem.itemIndex);
      expect(itemsAfterShrink.map((row) => row.itemIndex)).toEqual([0, 1, 2, 3]);
      expect(itemsAfterShrink.every((row) => row.state === 'stale')).toBe(true);
    });

    it('throws a named error when the item count changes but an existing item is not already stale', async () => {
      const graph = [shotsStage(['a', 'b']), brollStage(0)];
      const created = await createRun(graph, { forceFail: '__none__' });
      const runner = testApp.app.get(StageRunnerService);
      const shotsExecution = created.stageExecutions.find((e) => e.stageKey === 'shots')!;
      const brollExecution = created.stageExecutions.find((e) => e.stageKey === 'broll')!;
      await passShotsStage(runner, created.id, shotsExecution.id);

      await runner.ensureStageItems(brollExecution.id, 2);
      // Items 0 and 1 stay 'pending' — never run, never invalidated.

      await expect(runner.ensureStageItems(brollExecution.id, 3)).rejects.toThrow(
        /StageRunnerService\.ensureStageItems:.*item count changed.*InvalidationService\.apply\(\)/s,
      );

      // The rejected call must not have overwritten itemCount.
      const [execAfterThrow] = await testDb.db
        .select()
        .from(stageExecution)
        .where(eq(stageExecution.id, brollExecution.id));
      expect(execAfterThrow?.itemCount).toBe(2);
    });

    it('a grow-after-shrink round trip does not throw or duplicate rows once every item is stale each time', async () => {
      const graph = [shotsStage(['a', 'b', 'c', 'd']), brollStage(0)];
      const created = await createRun(graph, { forceFail: '__none__' });
      const runner = testApp.app.get(StageRunnerService);
      const shotsExecution = created.stageExecutions.find((e) => e.stageKey === 'shots')!;
      const brollExecution = created.stageExecutions.find((e) => e.stageKey === 'broll')!;
      await passShotsStage(runner, created.id, shotsExecution.id);

      await runner.ensureStageItems(brollExecution.id, 4);
      await markAllItemsStale(brollExecution.id);
      await runner.ensureStageItems(brollExecution.id, 2); // shrink
      await markAllItemsStale(brollExecution.id);
      await runner.ensureStageItems(brollExecution.id, 4); // grow back

      const items = await testDb.db
        .select()
        .from(stageItem)
        .where(eq(stageItem.stageExecutionId, brollExecution.id))
        .orderBy(stageItem.itemIndex);
      // ON CONFLICT DO NOTHING correctly no-ops on the pre-existing rows —
      // no duplicates for indices 0-3.
      expect(items.map((row) => row.itemIndex)).toEqual([0, 1, 2, 3]);

      const [execFinal] = await testDb.db
        .select()
        .from(stageExecution)
        .where(eq(stageExecution.id, brollExecution.id));
      expect(execFinal?.itemCount).toBe(4);
    });
  });
});
