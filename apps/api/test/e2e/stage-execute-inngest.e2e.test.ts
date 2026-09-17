import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InngestTestEngine, mockCtx } from '@inngest/test';
import type { Context } from 'inngest';
import { and, eq, isNull } from 'drizzle-orm';
import type { StageDef } from '@reefcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import type { StageExecuteEventData } from '../../src/orchestration/functions/stage-execute.fn';
import { stageAttempt, stageExecution, ledgerEntry, artifact } from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

/** See the `execute()` helper below — `step.sleep` needs stubbing to resolve
 * immediately under `InngestTestEngine`; every other step tool stays real. */
function skipSleepCtx(ctx: Context.Any): Context.Any {
  const mocked = mockCtx(ctx);
  (mocked.step.sleep as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(
    undefined,
  );
  return mocked;
}

/**
 * §13.1/§13.3 — runs the REAL `stage.execute` Inngest function (real steps,
 * no `steps:` mocking) through `InngestTestEngine`, against a real per-suite
 * Postgres DB. Complements `semantic-retry.e2e.test.ts` (direct
 * `StageRunnerService` calls, no Inngest involved) by proving the
 * `while(true)` loop's step-id scheme (`iteration` vs the DB-derived
 * `attemptCtx.attemptNo`) survives real step chain-following.
 *
 * NOT covered here, deliberately: `stage.execute` is `{retries: 0}`, and
 * `InngestTestEngine` never simulates platform-level step retries at all —
 * any step throwing ends the run immediately. So the "a bounded transport
 * blip is absorbed by Inngest's own step retry without incrementing
 * attempt_no" scenario stays covered exclusively by
 * `semantic-retry.e2e.test.ts`'s direct-service test; it is not
 * reproducible through this driver and this file does not attempt to.
 */
describe('stage.execute (real Inngest steps, e2e)', () => {
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

  async function setupRun(graph: StageDef[], channelDefaults: Record<string, unknown> = {}) {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);

    const channel = await channels.create('local', {
      name: `Stage Execute Inngest Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: channelDefaults,
    });
    const blueprintId = await blueprints.ensureBlueprint(
      channel.id,
      'Stage Execute Inngest Blueprint',
    );
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

  async function execute(data: StageExecuteEventData) {
    const engine = new InngestTestEngine({
      function: stageExecuteFn,
      events: [{ name: 'stage/execute.requested', data }],
      // `step.sleep` under `InngestTestEngine` hangs indefinitely rather than
      // resolving immediately (verified empirically — there's no real
      // platform here to schedule the wake-up) — every other step tool stays
      // a real call-through spy via `mockCtx`, only `sleep` is stubbed.
      transformCtx: skipSleepCtx,
    });
    return engine.execute();
  }

  it('happy path: one stage, no checks/qc, resolves passed', async () => {
    const graph: StageDef[] = [
      {
        key: 'outline',
        label: 'Outline',
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
    const { run } = await setupRun(graph);
    const execution = run.stageExecutions.find((e) => e.stageKey === 'outline');
    if (!execution) throw new Error('stage execution not found');

    const { result, error } = await execute({
      runId: run.id,
      stageExecutionId: execution.id,
      stageKey: 'outline',
    });
    expect(error).toBeUndefined();
    expect(result).toMatchObject({ outcome: 'passed' });

    const [executionRow] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, execution.id));
    expect(executionRow?.state).toBe('passed');

    const rows = await testDb.db
      .select()
      .from(stageAttempt)
      .where(
        and(eq(stageAttempt.stageExecutionId, execution.id), isNull(stageAttempt.stageItemId)),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe('success');

    const artifactRows = await testDb.db.select().from(artifact).where(eq(artifact.runId, run.id));
    expect(artifactRows.filter((a) => a.stale === false)).toHaveLength(1);

    const ledgerRows = await testDb.db
      .select()
      .from(ledgerEntry)
      .where(and(eq(ledgerEntry.runId, run.id), eq(ledgerEntry.category, 'stage_output')));
    expect(ledgerRows).toHaveLength(1);
  });

  it('check_failed on attempt 1 retries and succeeds on attempt 2, via the real priorCritique splice', async () => {
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
        model: { provider: 'fake', modelId: 'fake-text-1', params: {} },
      },
    ];
    const { run } = await setupRun(graph);
    const execution = run.stageExecutions.find((e) => e.stageKey === 'script');
    if (!execution) throw new Error('stage execution not found');

    const { result, error } = await execute({
      runId: run.id,
      stageExecutionId: execution.id,
      stageKey: 'script',
    });
    expect(error).toBeUndefined();
    expect(result).toMatchObject({ outcome: 'passed' });

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
    // The part a direct-service call can't prove: the real `iteration`
    // step-id counter and the DB-derived `attemptNo` didn't get conflated
    // under real step chain-following — attempt 2's persisted prompt really
    // contains attempt 1's critique.
    expect(byAttempt.get(2)?.renderedPrompt).toContain('Attempt 1 failed');
  });

  it('exhausted semantic retries fails the stage', async () => {
    const graph: StageDef[] = [
      {
        key: 'unfixable',
        label: 'Unfixable',
        capability: 'llm.generate',
        config: {},
        slots: {},
        context: {},
        output: { kind: 'text' },
        checks: [
          {
            type: 'builtin',
            key: 'regex_match',
            params: { pattern: 'ZZZ_NEVER_MATCHES_ZZZ', path: 'text' },
          },
        ],
        retryLimit: 0,
        model: { provider: 'fake', modelId: 'fake-text-1', params: {} },
      },
    ];
    const { run } = await setupRun(graph);
    const execution = run.stageExecutions.find((e) => e.stageKey === 'unfixable');
    if (!execution) throw new Error('stage execution not found');

    const { result, error } = await execute({
      runId: run.id,
      stageExecutionId: execution.id,
      stageKey: 'unfixable',
    });
    expect(error).toBeUndefined();
    expect(result).toEqual({ outcome: 'failed', reason: 'check_failed' });

    const [executionRow] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, execution.id));
    expect(executionRow?.state).toBe('failed');
    expect((executionRow?.failure as { reason?: string } | null)?.reason).toBe('check_failed');
  });

  it('provider_timeout on attempt 1 retries, then fails the stage on attempt 2', async () => {
    const graph: StageDef[] = [
      {
        key: 'slow',
        label: 'Slow',
        capability: 'llm.generate',
        config: {},
        slots: {},
        context: {},
        output: { kind: 'text' },
        checks: [],
        retryLimit: 1,
        model: { provider: 'fake', modelId: 'fake-text-1:fail:timeout', params: {} },
      },
    ];
    // Shrinks the backoff loop (default maxWaitSec:120) so this test doesn't
    // chain-follow dozens of poll/sleep steps — InngestTestEngine's
    // `step.sleep` never actually blocks, but each step is still a real
    // re-invocation of the chain-follower.
    const { run } = await setupRun(graph, { polling: { maxWaitSec: 10 } });
    const execution = run.stageExecutions.find((e) => e.stageKey === 'slow');
    if (!execution) throw new Error('stage execution not found');

    const { result, error } = await execute({
      runId: run.id,
      stageExecutionId: execution.id,
      stageKey: 'slow',
    });
    expect(error).toBeUndefined();
    expect(result).toEqual({ outcome: 'failed', reason: 'provider_timeout' });

    const rows = await testDb.db
      .select()
      .from(stageAttempt)
      .where(
        and(eq(stageAttempt.stageExecutionId, execution.id), isNull(stageAttempt.stageItemId)),
      );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.outcome === 'provider_timeout' && r.phase === 'settled')).toBe(true);

    const [executionRow] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, execution.id));
    expect(executionRow?.state).toBe('failed');
  });

  it('a low-scoring QC verdict fails the stage immediately (qc_failed)', async () => {
    const graph: StageDef[] = [
      {
        key: 'judged',
        label: 'Judged',
        capability: 'llm.generate',
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
    const { run } = await setupRun(graph);
    const execution = run.stageExecutions.find((e) => e.stageKey === 'judged');
    if (!execution) throw new Error('stage execution not found');

    const { result, error } = await execute({
      runId: run.id,
      stageExecutionId: execution.id,
      stageKey: 'judged',
    });
    expect(error).toBeUndefined();
    expect(result).toEqual({
      outcome: 'failed',
      reason: expect.stringContaining('qc_failed:'),
    });
  });

  it('a QC judge that keeps erroring is terminal after exactly one generation attempt, regardless of retryLimit', async () => {
    const graph: StageDef[] = [
      {
        key: 'unjudgeable',
        label: 'Unjudgeable',
        capability: 'llm.generate',
        config: {},
        slots: {},
        context: {},
        output: { kind: 'text' },
        checks: [],
        qc: {
          criteria: 'be good',
          threshold: 70,
          includeInputs: false,
          model: { provider: 'fake', modelId: 'fake-text-1:fail:transport', params: {} },
        },
        retryLimit: 5,
        model: { provider: 'fake', modelId: 'fake-text-1', params: {} },
      },
    ];
    const { run } = await setupRun(graph);
    const execution = run.stageExecutions.find((e) => e.stageKey === 'unjudgeable');
    if (!execution) throw new Error('stage execution not found');

    const { result, error } = await execute({
      runId: run.id,
      stageExecutionId: execution.id,
      stageKey: 'unjudgeable',
    });
    expect(error).toBeUndefined();
    expect(result).toMatchObject({ outcome: 'failed' });

    const rows = await testDb.db
      .select()
      .from(stageAttempt)
      .where(
        and(eq(stageAttempt.stageExecutionId, execution.id), isNull(stageAttempt.stageItemId)),
      );
    // qc_error is terminal immediately — never loops back for another
    // generation attempt despite retryLimit:5 leaving plenty of room.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe('qc_error');
  });

  it('a poll() that reports a failed job is retried on a fresh attempt and succeeds', async () => {
    const graph: StageDef[] = [
      {
        key: 'flaky-poll',
        label: 'Flaky Poll',
        capability: 'llm.generate',
        config: {},
        slots: {},
        context: {},
        output: { kind: 'text' },
        checks: [],
        retryLimit: 1,
        model: { provider: 'fake', modelId: 'fake-text-1:fail:poll_failed:1', params: {} },
      },
    ];
    const { run } = await setupRun(graph);
    const execution = run.stageExecutions.find((e) => e.stageKey === 'flaky-poll');
    if (!execution) throw new Error('stage execution not found');

    const { result, error } = await execute({
      runId: run.id,
      stageExecutionId: execution.id,
      stageKey: 'flaky-poll',
    });
    expect(error).toBeUndefined();
    expect(result).toMatchObject({ outcome: 'passed' });

    const rows = await testDb.db
      .select()
      .from(stageAttempt)
      .where(
        and(eq(stageAttempt.stageExecutionId, execution.id), isNull(stageAttempt.stageItemId)),
      );
    expect(rows).toHaveLength(2);
    const byAttempt = new Map(rows.map((r) => [r.attemptNo, r]));
    expect(byAttempt.get(1)?.outcome).toBe('provider_error');
    expect(byAttempt.get(2)?.outcome).toBe('success');
  });
});
