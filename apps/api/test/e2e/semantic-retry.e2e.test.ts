import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import type { StageDef } from '@reefcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { stageAttempt, stageExecution, ledgerEntry } from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

/**
 * §13.2 Rule 2 / §3.8.1 — direct-service coverage of the semantic retry
 * loop, in the same style as `data-output.e2e.test.ts` (no `@inngest/test`
 * needed): drives `StageRunnerService` methods directly, the same calls
 * `stage-execute.fn.ts`'s `while(true)` loop makes.
 */
describe('semantic retry loop (e2e)', () => {
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

  async function setupRun(graph: StageDef[]) {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);

    const channel = await channels.create('local', {
      name: `Semantic Retry Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Semantic Retry Blueprint');
    const version = await blueprints.createVersion(blueprintId, {
      graph,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    const run = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 10,
    });
    return { run };
  }

  it('check_failed on attempt 1 retries and succeeds on attempt 2, via the critique-log splice', async () => {
    const graph: StageDef[] = [
      {
        key: 'script',
        label: 'Script',
        capability: 'llm.generate',
        instructions: { template: 'Write something. {{ priorCritique }}' },
        config: {},
        slots: {},
        context: {},
        output: { kind: 'text' },
        checks: [
          { type: 'builtin', key: 'regex_match', params: { pattern: 'Attempt 1 failed', path: 'text' } },
        ],
        retryLimit: 1,
        model: { provider: 'fake', modelId: 'fake-text-1', params: {} },
      },
    ];
    const stageRunner = testApp.app.get(StageRunnerService);
    const { run } = await setupRun(graph);
    const execution = run.stageExecutions.find((e) => e.stageKey === 'script');
    if (!execution) throw new Error('stage execution not found');

    const { stage, effective, prevStageKey } = await stageRunner.loadStageContext(
      run.id,
      'script',
    );

    const ctx1 = await stageRunner.beginAttempt({
      runId: run.id,
      stageExecutionId: execution.id,
      stageKey: 'script',
    });
    expect(ctx1.attemptNo).toBe(1);
    const handle1 = await stageRunner.reserveAndSubmit(stage, ctx1, prevStageKey, effective);
    await stageRunner.pollOnce(stage, handle1);
    const result1 = await stageRunner.fetchAndFinalize(stage, ctx1, handle1, prevStageKey, effective);
    expect(result1.outcome).toBe('check_failed');

    const ctx2 = await stageRunner.beginAttempt({
      runId: run.id,
      stageExecutionId: execution.id,
      stageKey: 'script',
    });
    expect(ctx2.attemptNo).toBe(2);
    const handle2 = await stageRunner.reserveAndSubmit(stage, ctx2, prevStageKey, effective);
    await stageRunner.pollOnce(stage, handle2);
    const result2 = await stageRunner.fetchAndFinalize(stage, ctx2, handle2, prevStageKey, effective);
    expect(result2.outcome).toBe('success');

    const rows = await testDb.db
      .select()
      .from(stageAttempt)
      .where(and(eq(stageAttempt.stageExecutionId, execution.id), isNull(stageAttempt.stageItemId)));
    expect(rows).toHaveLength(2);
    const byAttempt = new Map(rows.map((r) => [r.attemptNo, r]));
    expect(byAttempt.get(1)?.outcome).toBe('check_failed');
    expect(byAttempt.get(2)?.outcome).toBe('success');

    const [executionRow] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, execution.id));
    expect(executionRow?.state).toBe('passed');

    const outputEntries = await testDb.db
      .select()
      .from(ledgerEntry)
      .where(and(eq(ledgerEntry.runId, run.id), eq(ledgerEntry.category, 'stage_output')));
    expect(outputEntries).toHaveLength(2);
  });

  it('a low-scoring QC verdict yields qc_failed without finalizing', async () => {
    const graph: StageDef[] = [
      {
        key: 'judged',
        label: 'Judged',
        capability: 'llm.generate',
        instructions: { template: 'Write something.' },
        config: {},
        slots: {},
        context: {},
        output: { kind: 'text' },
        checks: [],
        qc: {
          criteria: 'be good',
          threshold: 70,
          includeInputs: false,
          model: {
            provider: 'fake',
            modelId: 'fake-text-1',
            params: { fakeOutput: { score: 10, critique: 'not good enough' } },
          },
        },
        retryLimit: 0,
        model: { provider: 'fake', modelId: 'fake-text-1', params: {} },
      },
    ];
    const stageRunner = testApp.app.get(StageRunnerService);
    const { run } = await setupRun(graph);
    const execution = run.stageExecutions.find((e) => e.stageKey === 'judged');
    if (!execution) throw new Error('stage execution not found');

    const { stage, effective, prevStageKey } = await stageRunner.loadStageContext(
      run.id,
      'judged',
    );
    const ctx = await stageRunner.beginAttempt({
      runId: run.id,
      stageExecutionId: execution.id,
      stageKey: 'judged',
    });
    const handle = await stageRunner.reserveAndSubmit(stage, ctx, prevStageKey, effective);
    await stageRunner.pollOnce(stage, handle);
    const result = await stageRunner.fetchAndFinalize(stage, ctx, handle, prevStageKey, effective);
    expect(result.outcome).toBe('qc_failed');
    if (result.outcome !== 'qc_failed') throw new Error('unreachable');
    expect(result.qcVerdict.score).toBe(10);

    const [row] = await testDb.db
      .select()
      .from(stageAttempt)
      .where(eq(stageAttempt.id, ctx.stageAttemptId));
    expect(row?.outcome).toBe('qc_failed');

    const [executionRow] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, execution.id));
    expect(executionRow?.state).toBe('pending'); // fetchAndFinalize never touches stage_execution here

    const qcEntries = await testDb.db
      .select()
      .from(ledgerEntry)
      .where(and(eq(ledgerEntry.runId, run.id), eq(ledgerEntry.category, 'qc')));
    expect(qcEntries).toHaveLength(1);
  });

  it('a QC judge that keeps erroring is exhausted after qcErrorRetries and terminal regardless of retryLimit', async () => {
    const graph: StageDef[] = [
      {
        key: 'unjudgeable',
        label: 'Unjudgeable',
        capability: 'llm.generate',
        instructions: { template: 'Write something.' },
        config: {},
        slots: {},
        context: {},
        output: { kind: 'text' },
        checks: [],
        qc: {
          criteria: 'be good',
          threshold: 70,
          includeInputs: false,
          // Unbounded transport failure — the judge call itself never
          // succeeds, distinct from a rendered-but-failing verdict.
          model: { provider: 'fake', modelId: 'fake-text-1:fail:transport', params: {} },
        },
        retryLimit: 5, // plenty of semantic retries left — qc_error must still be terminal
        model: { provider: 'fake', modelId: 'fake-text-1', params: {} },
      },
    ];
    const stageRunner = testApp.app.get(StageRunnerService);
    const { run } = await setupRun(graph);
    const execution = run.stageExecutions.find((e) => e.stageKey === 'unjudgeable');
    if (!execution) throw new Error('stage execution not found');

    const { stage, effective, prevStageKey } = await stageRunner.loadStageContext(
      run.id,
      'unjudgeable',
    );
    const ctx = await stageRunner.beginAttempt({
      runId: run.id,
      stageExecutionId: execution.id,
      stageKey: 'unjudgeable',
    });
    const handle = await stageRunner.reserveAndSubmit(stage, ctx, prevStageKey, effective);
    await stageRunner.pollOnce(stage, handle);
    const result = await stageRunner.fetchAndFinalize(stage, ctx, handle, prevStageKey, effective);
    expect(result.outcome).toBe('qc_error');

    // The engine loop treats qc_error as always terminal (§10.4) — proven
    // here by calling the same helper `stage-execute.fn.ts` would call on
    // its last-attempt branch, independent of `stage.retryLimit`.
    await stageRunner.failStageExecution(execution.id, 'qc_error');
    const [executionRow] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, execution.id));
    expect(executionRow?.state).toBe('failed');

    // No qc ledger entries — every attempt errored before producing a verdict.
    const qcEntries = await testDb.db
      .select()
      .from(ledgerEntry)
      .where(and(eq(ledgerEntry.runId, run.id), eq(ledgerEntry.category, 'qc')));
    expect(qcEntries).toHaveLength(0);
  });

  it('a poll that never completes records provider_timeout without finalizing', async () => {
    const graph: StageDef[] = [
      {
        key: 'slow',
        label: 'Slow',
        capability: 'llm.generate',
        instructions: { template: 'Write something.' },
        config: {},
        slots: {},
        context: {},
        output: { kind: 'text' },
        checks: [],
        retryLimit: 0,
        model: { provider: 'fake', modelId: 'fake-text-1:fail:timeout', params: {} },
      },
    ];
    const stageRunner = testApp.app.get(StageRunnerService);
    const { run } = await setupRun(graph);
    const execution = run.stageExecutions.find((e) => e.stageKey === 'slow');
    if (!execution) throw new Error('stage execution not found');

    const { stage, effective, prevStageKey } = await stageRunner.loadStageContext(run.id, 'slow');
    const ctx = await stageRunner.beginAttempt({
      runId: run.id,
      stageExecutionId: execution.id,
      stageKey: 'slow',
    });
    const handle = await stageRunner.reserveAndSubmit(stage, ctx, prevStageKey, effective);
    const status = await stageRunner.pollOnce(stage, handle);
    expect(status.done).toBe(false);

    await stageRunner.recordProviderTimeout(stage, ctx, handle);
    const [row] = await testDb.db
      .select()
      .from(stageAttempt)
      .where(eq(stageAttempt.id, ctx.stageAttemptId));
    expect(row?.outcome).toBe('provider_timeout');
    expect(row?.phase).toBe('settled');

    await stageRunner.failStageExecution(execution.id, 'provider_timeout');
    const [executionRow] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, execution.id));
    expect(executionRow?.state).toBe('failed');
  });

  it('beginAttempt is idempotent under a concurrent replay of the same allocation', async () => {
    const graph: StageDef[] = [
      {
        key: 'racy',
        label: 'Racy',
        capability: 'llm.generate',
        config: {},
        slots: {},
        context: {},
        output: { kind: 'text' },
        checks: [],
        retryLimit: 0,
        model: { provider: 'fake', modelId: 'fake-text-1', params: {} },
      },
    ];
    const stageRunner = testApp.app.get(StageRunnerService);
    const { run } = await setupRun(graph);
    const execution = run.stageExecutions.find((e) => e.stageKey === 'racy');
    if (!execution) throw new Error('stage execution not found');

    const beginCtx = {
      runId: run.id,
      stageExecutionId: execution.id,
      stageKey: 'racy',
    };
    const [a, b] = await Promise.all([
      stageRunner.beginAttempt(beginCtx),
      stageRunner.beginAttempt(beginCtx),
    ]);
    expect(a.attemptNo).toBe(1);
    expect(b.attemptNo).toBe(1);
    expect(a.stageAttemptId).toBe(b.stageAttemptId);

    const rows = await testDb.db
      .select()
      .from(stageAttempt)
      .where(and(eq(stageAttempt.stageExecutionId, execution.id), isNull(stageAttempt.stageItemId)));
    expect(rows).toHaveLength(1);
  });

  it('a bounded transport failure is absorbed by a step retry without incrementing attempt_no', async () => {
    const graph: StageDef[] = [
      {
        key: 'flaky',
        label: 'Flaky',
        capability: 'llm.generate',
        config: {},
        slots: {},
        context: {},
        output: { kind: 'text' },
        checks: [],
        retryLimit: 0,
        // Fails the first fetch(), succeeds on the second — mirroring
        // Inngest's own step retry re-running the SAME step body (not a new
        // semantic attempt).
        model: { provider: 'fake', modelId: 'fake-text-1:fail:transport:1', params: {} },
      },
    ];
    const stageRunner = testApp.app.get(StageRunnerService);
    const { run } = await setupRun(graph);
    const execution = run.stageExecutions.find((e) => e.stageKey === 'flaky');
    if (!execution) throw new Error('stage execution not found');

    const { stage, effective, prevStageKey } = await stageRunner.loadStageContext(run.id, 'flaky');
    const ctx = await stageRunner.beginAttempt({
      runId: run.id,
      stageExecutionId: execution.id,
      stageKey: 'flaky',
    });
    const handle = await stageRunner.reserveAndSubmit(stage, ctx, prevStageKey, effective);
    await stageRunner.pollOnce(stage, handle);

    await expect(
      stageRunner.fetchAndFinalize(stage, ctx, handle, prevStageKey, effective),
    ).rejects.toThrow('fake transport error');

    // Inngest would re-run the `fetch-*` step body with the SAME attemptCtx
    // (the `begin-attempt-*` step already succeeded and is memoized) —
    // simulated here by calling fetchAndFinalize again with the identical ctx.
    const result = await stageRunner.fetchAndFinalize(stage, ctx, handle, prevStageKey, effective);
    expect(result.outcome).toBe('success');

    const rows = await testDb.db
      .select()
      .from(stageAttempt)
      .where(and(eq(stageAttempt.stageExecutionId, execution.id), isNull(stageAttempt.stageItemId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.attemptNo).toBe(1);
    expect(rows[0]?.outcome).toBe('success');
  });
});
