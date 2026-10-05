import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import type { StageDef } from '@reelcraft/shared';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { ChannelService } from '../../src/channel/channel.service';
import { RunService } from '../../src/run/run.service';
import { HumanActionService } from '../../src/run/human-action.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { runStageAttemptLoop } from '../../src/orchestration/functions/stage-attempt-loop';
import { QcRunner, type QcOutcome } from '../../src/qc/qc-runner.service';
import { humanWait, run, runWakeup, stageAttempt, stageExecution } from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

/**
 * Quality control that cannot run does not fail the stage: the output is
 * parked behind the approval gate, and "Retry QC" judges the stored output
 * again, without generating it a second time.
 */
describe('QC unavailable pauses for review, and Retry QC judges again (e2e)', () => {
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

  const stage: StageDef = {
    key: 'draft',
    label: 'Draft',
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    qc: {
      criteria: 'be good',
      threshold: 70,
      includeInputs: false,
      model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 64 } },
    },
    retryLimit: 0,
    model: {
      provider: 'fake',
      modelId: 'fake-text-1',
      params: { max_tokens: 64, fakeOutput: 'a draft' },
    },
  };

  const judgeDown: QcOutcome = { status: 'error', reason: 'judge unreachable', costUsd: 0 };
  const judgeSaysYes: QcOutcome = {
    status: 'passed',
    verdict: { score: 90, critique: 'good', dimensions: [] },
    costUsd: 0,
  };
  const judgeSaysNo: QcOutcome = {
    status: 'failed',
    verdict: { score: 20, critique: 'too generic', dimensions: [] },
    costUsd: 0,
  };

  async function startRun() {
    const channel = await testApp.app.get(ChannelService).create('local', {
      name: `QC Retry ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprints = testApp.app.get(BlueprintService);
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'QC Retry');
    const version = await blueprints.createVersion(blueprintId, {
      graph: [stage],
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    const created = await testApp.app.get(RunService).create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });
    await testDb.db.update(run).set({ state: 'RUNNING' }).where(eq(run.id, created.id));
    return { runId: created.id, executionId: created.stageExecutions[0]!.id };
  }

  /** The stage's attempt loop with plain steps, as `stage.execute` runs it. */
  async function runLoop(runId: string, executionId: string) {
    const runner = testApp.app.get(StageRunnerService);
    const {
      stage: loaded,
      effective,
      prevStageKey,
    } = await runner.loadStageContext(runId, 'draft');
    return runStageAttemptLoop({
      step: { run: (_id: string, fn: () => unknown) => fn(), sleep: vi.fn() } as never,
      logger: { warn: vi.fn() } as never,
      runner,
      stage: loaded,
      effective,
      prevStageKey,
      runId,
      stageExecutionId: executionId,
      stageKey: 'draft',
      retryLimit: 0,
    });
  }

  const attemptsOf = (executionId: string) =>
    testDb.db
      .select()
      .from(stageAttempt)
      .where(and(eq(stageAttempt.stageExecutionId, executionId), isNull(stageAttempt.stageItemId)))
      .orderBy(stageAttempt.attemptNo);

  /** The run as it stands once the orchestrator has resumed it. */
  async function resumed(runId: string) {
    await testDb.db.update(run).set({ state: 'RUNNING' }).where(eq(run.id, runId));
  }

  /** The run as it stands once the orchestrator has parked it for approval. */
  async function pausedForApproval(runId: string) {
    await testDb.db
      .update(run)
      .set({ state: 'PAUSED_APPROVAL', cursorStageKey: 'draft' })
      .where(eq(run.id, runId));
  }

  it('parks the output instead of failing the stage when the judge cannot run', async () => {
    const { runId, executionId } = await startRun();
    vi.spyOn(testApp.app.get(QcRunner), 'run').mockResolvedValue(judgeDown);

    await expect(runLoop(runId, executionId)).resolves.toMatchObject({
      outcome: 'approval_required',
    });

    const [attempt] = await attemptsOf(executionId);
    expect(attempt).toMatchObject({ outcome: 'qc_error', phase: 'awaiting_approval' });
    expect(attempt?.reviewNote).toContain('judge unreachable');
    expect(attempt?.artifactId).toBeTruthy();
    const [execution] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, executionId));
    expect(execution?.state).toBe('awaiting_approval');
    expect(execution?.failure).toBeNull();
    const waits = await testDb.db
      .select()
      .from(humanWait)
      .where(and(eq(humanWait.stageExecutionId, executionId), isNull(humanWait.resolvedAt)));
    expect(waits.map((w) => w.kind)).toEqual(['approval']);
  });

  it('Retry QC judges the stored output again and passes it, with no second generation', async () => {
    const { runId, executionId } = await startRun();
    const judge = vi.spyOn(testApp.app.get(QcRunner), 'run').mockResolvedValue(judgeDown);
    await runLoop(runId, executionId);
    await pausedForApproval(runId);

    const wakeupsBefore = await testDb.db
      .select()
      .from(runWakeup)
      .where(eq(runWakeup.runId, runId));
    await testApp.app.get(HumanActionService).retryQc(runId, 'draft');
    const wakeups = await testDb.db.select().from(runWakeup).where(eq(runWakeup.runId, runId));
    expect(wakeups).toHaveLength(wakeupsBefore.length + 1);
    expect(wakeups.at(-1)).toMatchObject({ action: 'retry_qc', eventName: 'run/resumed' });
    const [released] = await attemptsOf(executionId);
    expect(released).toMatchObject({ outcome: 'qc_error', phase: 'settled' });

    // The judge is back; the run resumes into the stage.
    judge.mockResolvedValue(judgeSaysYes);
    await resumed(runId);
    await expect(runLoop(runId, executionId)).resolves.toMatchObject({ outcome: 'passed' });

    const attempts = await attemptsOf(executionId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ outcome: 'success', phase: 'settled' });
    const [execution] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, executionId));
    expect(execution?.state).toBe('passed');
  });

  it('pauses again when QC still cannot run on the retry', async () => {
    const { runId, executionId } = await startRun();
    vi.spyOn(testApp.app.get(QcRunner), 'run').mockResolvedValue(judgeDown);
    await runLoop(runId, executionId);
    await pausedForApproval(runId);
    await testApp.app.get(HumanActionService).retryQc(runId, 'draft');
    await resumed(runId);

    await expect(runLoop(runId, executionId)).resolves.toMatchObject({
      outcome: 'approval_required',
    });
    const attempts = await attemptsOf(executionId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ outcome: 'qc_error', phase: 'awaiting_approval' });
  });

  it('regenerates with the critique when the retried QC rejects the output', async () => {
    const { runId, executionId } = await startRun();
    const judge = vi.spyOn(testApp.app.get(QcRunner), 'run').mockResolvedValue(judgeDown);
    await runLoop(runId, executionId);
    await pausedForApproval(runId);
    await testApp.app.get(HumanActionService).retryQc(runId, 'draft');

    judge.mockResolvedValueOnce(judgeSaysNo).mockResolvedValue(judgeSaysYes);
    await resumed(runId);
    await expect(runLoop(runId, executionId)).resolves.toMatchObject({ outcome: 'passed' });

    const attempts = await attemptsOf(executionId);
    expect(attempts.map((a) => a.outcome)).toEqual(['qc_failed', 'success']);
    expect(attempts[1]?.renderedPrompt).toContain('too generic');
  });

  it('refuses to retry QC on an output that was not parked for it', async () => {
    const { runId, executionId } = await startRun();
    vi.spyOn(testApp.app.get(QcRunner), 'run').mockResolvedValue(judgeSaysYes);
    await runLoop(runId, executionId);
    await pausedForApproval(runId);
    await expect(testApp.app.get(HumanActionService).retryQc(runId, 'draft')).rejects.toThrow(
      /did not fail|pending/i,
    );
  });
});
