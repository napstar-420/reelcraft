import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { InputDef, StageDef } from '@reefcraft/shared';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { ChannelService } from '../../src/channel/channel.service';
import { RunService } from '../../src/run/run.service';
import { InvalidationService } from '../../src/run/invalidation.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { run, runMemory, stageExecution, stageItem } from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

/**
 * Phase 7 chunk 5 — `InvalidationService.preview()`/`.apply()` against a
 * REAL iterating stage driven to completion through `StageRunnerService`
 * (same style as `phase7-iteration.e2e.test.ts`'s Chunk 4 coverage), not
 * hand-inserted rows: the point is to exercise the actual DB plumbing this
 * chunk adds — item-scoped `stage_item.state`/`outputArtifactId` resets,
 * correctly indexed memory tombstones, and sibling items left completely
 * untouched — against a schema/data shape the engine itself produces. The
 * pure propagation math (same-stage cascade, alignWith pointwise, memory
 * group reads, whole-stage seeds) is already exhaustively covered by
 * `invalidation-closure.test.ts`'s unit tests; this file only needs to
 * prove the DB-facing wiring is correct for the simplest real case:
 * retrying one item of a stage that does NOT bind `prevItem`.
 */
describe('phase 7 chunk 5 — item-level invalidation (e2e)', () => {
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

  /** Does not bind `prevItem` — each item is independent, so retrying one
   * must never touch its siblings (the item-independence rule). Writes its
   * own value into Run Memory per item (`broll#i`) so tombstoning can be
   * exercised too. */
  function brollStage(): StageDef {
    return {
      key: 'broll',
      label: 'B-roll',
      capability: 'llm.generate',
      config: {},
      slots: { shot: { from: 'item' } },
      context: {},
      iterate: { over: { from: 'prev' }, itemAlias: 'shot', itemRetryLimit: 0 },
      writes: { broll: '$' },
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
      name: `Phase 7 Invalidation ${Date.now()} ${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Phase 7 Invalidation');
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

  async function passItem(
    runner: StageRunnerService,
    runId: string,
    executionId: string,
    stage: StageDef,
    effective: Awaited<ReturnType<StageRunnerService['loadStageContext']>>['effective'],
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
    if (submitted.outcome !== 'submitted')
      throw new Error(`unexpected submit: ${submitted.outcome}`);
    const result = await runner.fetchAndFinalize(
      stage,
      attemptCtx,
      submitted.handle,
      prevStageKey,
      effective,
    );
    if (result.outcome !== 'success') throw new Error(`unexpected fetch: ${result.outcome}`);
  }

  it('retrying one item stales only that item, tombstones only its memory index, and leaves siblings intact', async () => {
    const graph = [shotsStage(['ok0', 'ok1', 'ok2', 'ok3']), brollStage()];
    const created = await createRun(graph);
    const runner = testApp.app.get(StageRunnerService);
    const invalidation = testApp.app.get(InvalidationService);
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
    if (!resolved.ok) throw new Error(`unexpected resolveIterateCount: ${resolved.reason}`);
    await runner.ensureStageItems(brollExecution.id, resolved.itemCount);

    const pendingItems = await testDb.db
      .select()
      .from(stageItem)
      .where(eq(stageItem.stageExecutionId, brollExecution.id))
      .orderBy(stageItem.itemIndex);
    for (const item of pendingItems) {
      await passItem(
        runner,
        created.id,
        brollExecution.id,
        stage,
        effective,
        prevStageKey,
        item.itemIndex,
        item.id,
      );
    }
    await runner.finishIteratingStage(brollExecution.id);

    const itemsBefore = await testDb.db
      .select()
      .from(stageItem)
      .where(eq(stageItem.stageExecutionId, brollExecution.id))
      .orderBy(stageItem.itemIndex);
    expect(itemsBefore.map((row) => row.state)).toEqual(['passed', 'passed', 'passed', 'passed']);
    const artifactsBefore = itemsBefore.map((row) => row.outputArtifactId);
    expect(artifactsBefore.every((id) => id !== null)).toBe(true);

    const memoryBefore = await testDb.db
      .select()
      .from(runMemory)
      .where(eq(runMemory.runId, created.id))
      .orderBy(runMemory.memKey);
    expect(memoryBefore.filter((row) => row.memKey.startsWith('broll#'))).toHaveLength(4);
    expect(memoryBefore.every((row) => !row.tombstone)).toBe(true);

    // --- Retry item 1 only ---
    const preview = await invalidation.preview({
      runId: created.id,
      seed: { items: [{ stageKey: 'broll', itemIndex: 1 }] },
    });
    expect(preview.closure.affectedStageKeys).toEqual(['broll']);
    expect(preview.closure.affectedItems).toEqual([
      {
        stageKey: 'broll',
        stageExecutionId: brollExecution.id,
        itemIndex: 1,
        artifactId: artifactsBefore[1],
      },
    ]);
    expect(preview.closure.affectedArtifactIds).toEqual([artifactsBefore[1]]);

    await testDb.db.transaction((tx) =>
      invalidation.apply(tx, {
        runId: created.id,
        closure: preview.closure,
        targetStageKey: 'broll',
      }),
    );

    const itemsAfter = await testDb.db
      .select()
      .from(stageItem)
      .where(eq(stageItem.stageExecutionId, brollExecution.id))
      .orderBy(stageItem.itemIndex);
    expect(itemsAfter.map((row) => row.state)).toEqual(['passed', 'stale', 'passed', 'passed']);
    expect(itemsAfter[1]?.outputArtifactId).toBeNull();
    // Siblings' artifacts/state are byte-for-byte untouched.
    expect(itemsAfter[0]?.outputArtifactId).toBe(artifactsBefore[0]);
    expect(itemsAfter[2]?.outputArtifactId).toBe(artifactsBefore[2]);
    expect(itemsAfter[3]?.outputArtifactId).toBe(artifactsBefore[3]);

    // The stage_execution itself stays 'passed' — some items remain valid,
    // so the whole stage must not be discarded — but its generation still
    // ticks for UI labelling since it's the retry target.
    const [executionAfter] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, brollExecution.id));
    expect(executionAfter?.state).toBe('passed');
    expect(executionAfter?.generation).toBe(1);

    const memoryAfter = await testDb.db
      .select()
      .from(runMemory)
      .where(eq(runMemory.runId, created.id))
      .orderBy(runMemory.memKey, runMemory.version);
    const currentByKey = new Map<string, (typeof memoryAfter)[number]>();
    for (const row of memoryAfter) {
      const current = currentByKey.get(row.memKey);
      if (!current || row.version > current.version) currentByKey.set(row.memKey, row);
    }
    expect(currentByKey.get('broll#0')?.tombstone).toBe(false);
    expect(currentByKey.get('broll#1')?.tombstone).toBe(true);
    expect(currentByKey.get('broll#2')?.tombstone).toBe(false);
    expect(currentByKey.get('broll#3')?.tombstone).toBe(false);

    const [runAfter] = await testDb.db.select().from(run).where(eq(run.id, created.id));
    expect(runAfter?.cursorStageKey).toBe('broll');

    // A subsequent orchestration pass would see item 1 as needing rework:
    // `stage.execute`'s outer loop only skips an item whose state is
    // 'passed' (Chunk 4's `itemState` check).
    const item1State = await runner.itemState(brollExecution.id, 1);
    expect(item1State.state).not.toBe('passed');
    expect(item1State.state).toBe('stale');
  });
});
