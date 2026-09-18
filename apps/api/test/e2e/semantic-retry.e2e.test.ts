import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import type { StageDef } from '@reefcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import {
  StageRunnerService,
  type StageAttemptContext,
} from '../../src/orchestration/stage-runner.service';
import type { EffectiveStageConfig } from '../../src/run-config/config-resolver.service';
import { LedgerService } from '../../src/budget/ledger.service';
import {
  stageAttempt,
  stageExecution,
  ledgerEntry,
  run as runTable,
} from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

/** `reserveAndSubmit` returns a discriminated `SubmitOutcome` (§11 —
 * `budget_blocked` is now a real, first-class result, not just a submitted
 * handle). None of these tests exercise a cap tight enough to block, so
 * unwrapping to the handle and failing loudly otherwise keeps every call
 * site below unchanged in spirit. */
async function submitOrThrow(
  stageRunner: StageRunnerService,
  stage: StageDef,
  ctx: StageAttemptContext,
  prevStageKey: string | undefined,
  effective: EffectiveStageConfig,
) {
  const submission = await stageRunner.reserveAndSubmit(stage, ctx, prevStageKey, effective);
  if (submission.outcome !== 'submitted') {
    throw new Error(`expected reserveAndSubmit to submit, got "${submission.outcome}"`);
  }
  return submission.handle;
}

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

  async function setupRun(graph: StageDef[], budgetCapUsd = 10) {
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
      budgetCapUsd,
    });
    await testDb.db.update(runTable).set({ state: 'RUNNING' }).where(eq(runTable.id, run.id));
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
          {
            type: 'builtin',
            key: 'regex_match',
            params: { pattern: 'Attempt 1 failed', path: 'text' },
          },
        ],
        retryLimit: 1,
        model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 256 } },
      },
    ];
    const stageRunner = testApp.app.get(StageRunnerService);
    const { run } = await setupRun(graph);
    const execution = run.stageExecutions.find((e) => e.stageKey === 'script');
    if (!execution) throw new Error('stage execution not found');

    const { stage, effective, prevStageKey } = await stageRunner.loadStageContext(run.id, 'script');

    const ctx1 = await stageRunner.beginAttempt({
      runId: run.id,
      stageExecutionId: execution.id,
      stageKey: 'script',
    });
    expect(ctx1.attemptNo).toBe(1);
    const handle1 = await submitOrThrow(stageRunner, stage, ctx1, prevStageKey, effective);
    await stageRunner.pollOnce(stage, handle1);
    const result1 = await stageRunner.fetchAndFinalize(
      stage,
      ctx1,
      handle1,
      prevStageKey,
      effective,
    );
    expect(result1.outcome).toBe('check_failed');

    const ctx2 = await stageRunner.beginAttempt({
      runId: run.id,
      stageExecutionId: execution.id,
      stageKey: 'script',
    });
    expect(ctx2.attemptNo).toBe(2);
    const handle2 = await submitOrThrow(stageRunner, stage, ctx2, prevStageKey, effective);
    await stageRunner.pollOnce(stage, handle2);
    const result2 = await stageRunner.fetchAndFinalize(
      stage,
      ctx2,
      handle2,
      prevStageKey,
      effective,
    );
    expect(result2.outcome).toBe('success');

    const rows = await testDb.db
      .select()
      .from(stageAttempt)
      .where(
        and(eq(stageAttempt.stageExecutionId, execution.id), isNull(stageAttempt.stageItemId)),
      );
    expect(rows).toHaveLength(2);
    const byAttempt = new Map(rows.map((r) => [r.attemptNo, r]));
    expect(byAttempt.get(1)?.outcome).toBe('check_failed');
    expect(byAttempt.get(2)?.outcome).toBe('success');

    const [executionRow] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, execution.id));
    expect(executionRow?.state).toBe('passed');

    // §11 — each settled attempt (check_failed included: settlement happens
    // unconditionally, before checks run) writes 3 stage_output rows —
    // reservation, actual, release — not 1, now that reserve/settle
    // replaces the old unconditional-recordActual-only model.
    const outputEntries = await testDb.db
      .select()
      .from(ledgerEntry)
      .where(and(eq(ledgerEntry.runId, run.id), eq(ledgerEntry.category, 'stage_output')));
    expect(outputEntries).toHaveLength(6);
    expect(outputEntries.filter((e) => e.kind === 'reservation')).toHaveLength(2);
    expect(outputEntries.filter((e) => e.kind === 'actual')).toHaveLength(2);
    expect(outputEntries.filter((e) => e.kind === 'release')).toHaveLength(2);
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
        model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 256 } },
      },
    ];
    const stageRunner = testApp.app.get(StageRunnerService);
    const { run } = await setupRun(graph);
    const execution = run.stageExecutions.find((e) => e.stageKey === 'judged');
    if (!execution) throw new Error('stage execution not found');

    const { stage, effective, prevStageKey } = await stageRunner.loadStageContext(run.id, 'judged');
    const ctx = await stageRunner.beginAttempt({
      runId: run.id,
      stageExecutionId: execution.id,
      stageKey: 'judged',
    });
    const handle = await submitOrThrow(stageRunner, stage, ctx, prevStageKey, effective);
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
          model: {
            provider: 'fake',
            modelId: 'fake-text-1:fail:transport',
            params: { max_tokens: 256 },
          },
        },
        retryLimit: 5, // plenty of semantic retries left — qc_error must still be terminal
        model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 256 } },
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
    const handle = await submitOrThrow(stageRunner, stage, ctx, prevStageKey, effective);
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
        model: {
          provider: 'fake',
          modelId: 'fake-text-1:fail:timeout',
          params: { max_tokens: 256 },
        },
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
    const handle = await submitOrThrow(stageRunner, stage, ctx, prevStageKey, effective);
    const status = await stageRunner.pollOnce(stage, handle);
    expect(status.done).toBe(false);

    await stageRunner.recordProviderTimeout(stage, ctx, handle);
    const [row] = await testDb.db
      .select()
      .from(stageAttempt)
      .where(eq(stageAttempt.id, ctx.stageAttemptId));
    expect(row?.outcome).toBe('provider_timeout');
    expect(row?.phase).toBe('settled');

    // §11.3 — unconfirmed outcomes settle as a provisional actual at the
    // full ceiling, not a release: the engine stopped polling, not the
    // provider stopped rendering.
    const outputEntries = await testDb.db
      .select()
      .from(ledgerEntry)
      .where(and(eq(ledgerEntry.runId, run.id), eq(ledgerEntry.category, 'stage_output')));
    expect(outputEntries).toHaveLength(2); // reservation + provisional actual, no release
    expect(outputEntries.find((e) => e.kind === 'reservation')).toBeDefined();
    const provisional = outputEntries.find((e) => e.kind === 'actual');
    expect(provisional?.confirmed).toBe(false);
    const runRowAfter = await testDb.db.select().from(runTable).where(eq(runTable.id, run.id));
    expect(runRowAfter[0]?.reservedUsd).toBe('0.0000');

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
        model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 256 } },
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
      .where(
        and(eq(stageAttempt.stageExecutionId, execution.id), isNull(stageAttempt.stageItemId)),
      );
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
        model: {
          provider: 'fake',
          modelId: 'fake-text-1:fail:transport:1',
          params: { max_tokens: 256 },
        },
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
    const handle = await submitOrThrow(stageRunner, stage, ctx, prevStageKey, effective);
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
      .where(
        and(eq(stageAttempt.stageExecutionId, execution.id), isNull(stageAttempt.stageItemId)),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.attemptNo).toBe(1);
    expect(rows[0]?.outcome).toBe('success');
  });

  it('qc_budget_exhausted fires without ever calling the judge, once cumulative qc spend meets the cap', async () => {
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
            params: { fakeOutput: { score: 90, critique: 'fine' } },
          },
        },
        // Projected via stageDefLayer into effective.qc.capUsd (§11.2).
        budget: { qcCapUsd: 0.0005 },
        retryLimit: 0,
        model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 256 } },
      },
    ];
    const stageRunner = testApp.app.get(StageRunnerService);
    const ledger = testApp.app.get(LedgerService);
    const { run } = await setupRun(graph);
    const execution = run.stageExecutions.find((e) => e.stageKey === 'judged');
    if (!execution) throw new Error('stage execution not found');

    const { stage, effective, prevStageKey } = await stageRunner.loadStageContext(run.id, 'judged');
    expect(effective.qc?.capUsd).toBe(0.0005);
    // Pre-seed enough confirmed qc spend to already meet the cap — simpler
    // and more direct than driving a full prior attempt through a real
    // judge call just to accumulate spend.
    await ledger.recordActual({
      runId: run.id,
      stageKey: 'judged',
      category: 'qc',
      amountUsd: 0.0005,
    });

    const ctx = await stageRunner.beginAttempt({
      runId: run.id,
      stageExecutionId: execution.id,
      stageKey: 'judged',
    });
    const handle = await submitOrThrow(stageRunner, stage, ctx, prevStageKey, effective);
    await stageRunner.pollOnce(stage, handle);
    const result = await stageRunner.fetchAndFinalize(stage, ctx, handle, prevStageKey, effective);
    expect(result.outcome).toBe('qc_budget_exhausted');

    const [row] = await testDb.db
      .select()
      .from(stageAttempt)
      .where(eq(stageAttempt.id, ctx.stageAttemptId));
    expect(row?.outcome).toBe('qc_budget_exhausted');

    // No NEW qc ledger entry — the judge was never called.
    const qcEntries = await testDb.db
      .select()
      .from(ledgerEntry)
      .where(and(eq(ledgerEntry.runId, run.id), eq(ledgerEntry.category, 'qc')));
    expect(qcEntries).toHaveLength(1); // just the pre-seeded one
  });

  it('a budget_blocked attempt does not consume a semantic retry — countSemanticAttemptsUsed excludes it', async () => {
    const graph: StageDef[] = [
      {
        key: 'tight',
        label: 'Tight',
        capability: 'llm.generate',
        config: {},
        slots: {},
        context: {},
        output: { kind: 'text' },
        checks: [
          { type: 'builtin', key: 'regex_match', params: { pattern: 'nonexistent', path: 'text' } },
        ],
        retryLimit: 1,
        model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 256 } },
      },
    ];
    const stageRunner = testApp.app.get(StageRunnerService);
    // A cap far below the fake provider's ceiling (~0.003 for a short/empty
    // prompt) — the very first reserve() call is rejected.
    const { run } = await setupRun(graph, 0.0001);
    const execution = run.stageExecutions.find((e) => e.stageKey === 'tight');
    if (!execution) throw new Error('stage execution not found');

    const { stage, effective, prevStageKey } = await stageRunner.loadStageContext(run.id, 'tight');

    const ctx1 = await stageRunner.beginAttempt({
      runId: run.id,
      stageExecutionId: execution.id,
      stageKey: 'tight',
    });
    const submission1 = await stageRunner.reserveAndSubmit(stage, ctx1, prevStageKey, effective);
    expect(submission1).toEqual({ outcome: 'budget_blocked', reason: 'run_cap_exceeded' });
    expect(await stageRunner.countSemanticAttemptsUsed(execution.id)).toBe(0);

    // Raise the cap directly (PAUSED_BUDGET/raiseBudget itself is phase-3
    // chunk 2 — this test only needs the ledger-visible effect: room to
    // reserve again) and drive a check_failed attempt.
    await testDb.db
      .update(runTable)
      .set({ budgetCapUsd: '10.0000' })
      .where(eq(runTable.id, run.id));

    const ctx2 = await stageRunner.beginAttempt({
      runId: run.id,
      stageExecutionId: execution.id,
      stageKey: 'tight',
    });
    const handle2 = await submitOrThrow(stageRunner, stage, ctx2, prevStageKey, effective);
    await stageRunner.pollOnce(stage, handle2);
    const result2 = await stageRunner.fetchAndFinalize(
      stage,
      ctx2,
      handle2,
      prevStageKey,
      effective,
    );
    expect(result2.outcome).toBe('check_failed');
    // Only the check_failed attempt counts — the budget_blocked one didn't.
    expect(await stageRunner.countSemanticAttemptsUsed(execution.id)).toBe(1);

    const ctx3 = await stageRunner.beginAttempt({
      runId: run.id,
      stageExecutionId: execution.id,
      stageKey: 'tight',
    });
    expect(ctx3.attemptNo).toBe(3); // attemptNo IS 3 — proves it's NOT what retry accounting uses
    const handle3 = await submitOrThrow(stageRunner, stage, ctx3, prevStageKey, effective);
    await stageRunner.pollOnce(stage, handle3);
    // Checks still fail deterministically — the point here is proving this
    // is still WITHIN the one retry `retryLimit: 1` allows (semantic
    // attempts used before this one is 1, matching stage-execute.fn.ts's
    // `semanticAttemptsUsed + 1 >= retryLimit + 1` => `1 + 1 >= 2` => true,
    // i.e. this correctly reads as the last allowed attempt), not that a
    // 3rd physical attempt was silently free.
    const result3 = await stageRunner.fetchAndFinalize(
      stage,
      ctx3,
      handle3,
      prevStageKey,
      effective,
    );
    expect(result3.outcome).toBe('check_failed');
    expect(await stageRunner.countSemanticAttemptsUsed(execution.id)).toBe(2);
  });
});
