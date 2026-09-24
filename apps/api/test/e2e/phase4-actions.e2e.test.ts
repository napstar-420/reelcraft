import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import type { StageDef } from '@reefcraft/shared';
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
    await testApp.app.get(HumanActionService).approve(created.id, 'draft');

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
});
