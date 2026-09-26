import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import type { StageDef } from '@reelcraft/shared';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { ChannelService } from '../../src/channel/channel.service';
import { artifact, humanWait, ledgerEntry, run, stageAttempt } from '../../src/db/schema/index';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { HumanActionService } from '../../src/run/human-action.service';
import { RunCancellationService } from '../../src/run/run-cancellation.service';
import { RunService } from '../../src/run/run.service';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

function stage({ key, ...overrides }: Partial<StageDef> & Pick<StageDef, 'key'>): StageDef {
  return {
    key,
    label: key,
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    retryLimit: 0,
    model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 64 } },
    ...overrides,
  };
}

describe('Phase 4 approval, human input, and cancellation (e2e)', () => {
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
      name: `Phase 4 ${Date.now()} ${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Phase 4 Actions');
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
      budgetCapUsd: 10,
    });
    await testDb.db.update(run).set({ state: 'RUNNING' }).where(eq(run.id, created.id));
    return created;
  }

  it('keeps an approval candidate stale and memory-free until one locked approval activates it', async () => {
    const graph = [stage({ key: 'draft', approval: { mode: 'stage' }, writes: { draft: '$' } })];
    const created = await createRun(graph);
    const execution = created.stageExecutions[0]!;
    const runner = testApp.app.get(StageRunnerService);
    const {
      stage: definition,
      effective,
      prevStageKey,
    } = await runner.loadStageContext(created.id, 'draft');
    const attempt = await runner.beginAttempt({
      runId: created.id,
      stageExecutionId: execution.id,
      stageKey: 'draft',
    });
    const submitted = await runner.reserveAndSubmit(definition, attempt, prevStageKey, effective);
    if (submitted.outcome !== 'submitted') throw new Error('expected submission');
    const result = await runner.fetchAndFinalize(
      definition,
      attempt,
      submitted.handle,
      prevStageKey,
      effective,
    );
    expect(result.outcome).toBe('approval_required');
    const artifactId = result.outcome === 'approval_required' ? result.artifactId : '';
    expect(
      await testDb.db
        .select()
        .from(artifact)
        .where(and(eq(artifact.id, artifactId), eq(artifact.stale, true))),
    ).toHaveLength(1);

    await testDb.db
      .update(run)
      .set({ state: 'PAUSED_APPROVAL', cursorStageKey: 'draft' })
      .where(eq(run.id, created.id));

    const runs = testApp.app.get(RunService);
    const candidate = await runs.approvalCandidate(created.id, 'draft');
    expect(candidate).toMatchObject({
      stageKey: 'draft',
      itemIndex: null,
      attempt: {
        id: attempt.stageAttemptId,
        attemptNo: 1,
      },
      artifact: { id: artifactId, kind: 'text', previewUrl: null, attachments: [] },
    });
    expect((await runs.get(created.id)).stageExecutions[0]?.attemptCount).toBe(1);

    await testApp.app.get(HumanActionService).approve(created.id, 'draft');
    await expect(runs.approvalCandidate(created.id, 'draft')).rejects.toThrow(
      'No open approval wait exists',
    );

    expect(
      await testDb.db
        .select()
        .from(artifact)
        .where(and(eq(artifact.id, artifactId), eq(artifact.stale, false))),
    ).toHaveLength(1);
    expect(
      await testDb.db
        .select()
        .from(humanWait)
        .where(and(eq(humanWait.runId, created.id), isNull(humanWait.resolvedAt))),
    ).toHaveLength(0);
  });

  it('accepts a checked human value without provider spend, and cancellation resolves an open wait', async () => {
    const human = stage({ key: 'answer', capability: 'human.input' });
    const created = await createRun([human]);
    const execution = created.stageExecutions[0]!;
    const runner = testApp.app.get(StageRunnerService);
    await runner.awaitHumanInput(created.id, execution.id);
    await testDb.db
      .update(run)
      .set({ state: 'PAUSED_INPUT', cursorStageKey: 'answer' })
      .where(eq(run.id, created.id));

    await testApp.app.get(HumanActionService).submitInput(created.id, 'answer', 'reef keeper');
    const [attempt] = await testDb.db
      .select()
      .from(stageAttempt)
      .where(eq(stageAttempt.stageExecutionId, execution.id));
    expect(attempt).toMatchObject({ actor: 'user', outcome: 'success', costUsd: '0.0000' });
    expect(
      await testDb.db.select().from(ledgerEntry).where(eq(ledgerEntry.runId, created.id)),
    ).toHaveLength(0);

    const waitingRun = await createRun([human]);
    const waitingExecution = waitingRun.stageExecutions[0]!;
    await runner.awaitHumanInput(waitingRun.id, waitingExecution.id);
    await testDb.db
      .update(run)
      .set({ state: 'PAUSED_INPUT', cursorStageKey: 'answer' })
      .where(eq(run.id, waitingRun.id));
    await testApp.app.get(RunCancellationService).cancel(waitingRun.id);
    expect(
      await testDb.db
        .select()
        .from(humanWait)
        .where(and(eq(humanWait.runId, waitingRun.id), isNull(humanWait.resolvedAt))),
    ).toHaveLength(0);
  });

  it('lets an in-flight attempt commit through a manual pause, but still discards it on cancel', async () => {
    // This is the riskiest change in the manual pause/resume feature: the
    // fetchAndFinalize commit guard was loosened from `state === 'RUNNING'`
    // to `state === 'RUNNING' || 'PAUSED_MANUAL'`. Prove both halves: an
    // attempt paused mid-flight still commits (money already spent, don't
    // throw the output away), while every other non-RUNNING state — in
    // particular CANCELLED — still discards it exactly as before.
    const graph = [stage({ key: 'draft', writes: { draft: '$' } })];
    const runner = testApp.app.get(StageRunnerService);

    const paused = await createRun(graph);
    const pausedExecution = paused.stageExecutions[0]!;
    const {
      stage: pausedDef,
      effective: pausedEffective,
      prevStageKey: pausedPrev,
    } = await runner.loadStageContext(paused.id, 'draft');
    const pausedAttempt = await runner.beginAttempt({
      runId: paused.id,
      stageExecutionId: pausedExecution.id,
      stageKey: 'draft',
    });
    const pausedSubmitted = await runner.reserveAndSubmit(
      pausedDef,
      pausedAttempt,
      pausedPrev,
      pausedEffective,
    );
    if (pausedSubmitted.outcome !== 'submitted') throw new Error('expected submission');
    await testDb.db.update(run).set({ state: 'PAUSED_MANUAL' }).where(eq(run.id, paused.id));
    const pausedResult = await runner.fetchAndFinalize(
      pausedDef,
      pausedAttempt,
      pausedSubmitted.handle,
      pausedPrev,
      pausedEffective,
    );
    expect(pausedResult.outcome).not.toBe('run_not_running');
    const [pausedAttemptRow] = await testDb.db
      .select()
      .from(stageAttempt)
      .where(eq(stageAttempt.id, pausedAttempt.stageAttemptId));
    expect(pausedAttemptRow?.outcome).not.toBe('cancelled');

    const cancelled = await createRun(graph);
    const cancelledExecution = cancelled.stageExecutions[0]!;
    const {
      stage: cancelledDef,
      effective: cancelledEffective,
      prevStageKey: cancelledPrev,
    } = await runner.loadStageContext(cancelled.id, 'draft');
    const cancelledAttempt = await runner.beginAttempt({
      runId: cancelled.id,
      stageExecutionId: cancelledExecution.id,
      stageKey: 'draft',
    });
    const cancelledSubmitted = await runner.reserveAndSubmit(
      cancelledDef,
      cancelledAttempt,
      cancelledPrev,
      cancelledEffective,
    );
    if (cancelledSubmitted.outcome !== 'submitted') throw new Error('expected submission');
    await testDb.db.update(run).set({ state: 'CANCELLED' }).where(eq(run.id, cancelled.id));
    const cancelledResult = await runner.fetchAndFinalize(
      cancelledDef,
      cancelledAttempt,
      cancelledSubmitted.handle,
      cancelledPrev,
      cancelledEffective,
    );
    expect(cancelledResult.outcome).toBe('run_not_running');
    const [cancelledAttemptRow] = await testDb.db
      .select()
      .from(stageAttempt)
      .where(eq(stageAttempt.id, cancelledAttempt.stageAttemptId));
    expect(cancelledAttemptRow?.outcome).toBe('cancelled');
  });

  it('pauses a RUNNING run, then resumes and cancels it through the same policy table', async () => {
    const graph = [stage({ key: 'draft', writes: { draft: '$' } })];
    const created = await createRun(graph);
    const runs = testApp.app.get(RunService);

    const paused = await runs.pause(created.id);
    expect(paused.state).toBe('PAUSED_MANUAL');

    // resume() only enqueues a `run/resumed` wakeup — the actual RUNNING
    // transition happens later, asynchronously, when the orchestrator's
    // durable function claims that wakeup (not exercised by this test,
    // which never runs the Inngest engine). Immediately after resume()
    // returns, the persisted state is therefore still PAUSED_MANUAL.
    const resumed = await runs.resume(created.id);
    expect(resumed.state).toBe('PAUSED_MANUAL');

    const cancelResult = await testApp.app.get(RunCancellationService).cancel(created.id);
    expect(cancelResult.state).toBe('CANCELLED');
  });
});
