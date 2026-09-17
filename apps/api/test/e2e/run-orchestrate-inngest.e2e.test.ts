import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { InngestTestEngine, type InngestTestEngine as InngestTestEngineNs } from '@inngest/test';
import { eq } from 'drizzle-orm';
import type { StageDef } from '@reefcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import { run, stageExecution } from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

function stage(key: string): StageDef {
  return {
    key,
    label: key,
    capability: 'llm.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    retryLimit: 0,
    model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 256 } },
  };
}

/**
 * §13.4/§13.5 — `run.orchestrate` driven through the REAL Inngest function,
 * mocking only its `invoke-stage-<key>` steps via `InngestTestEngine`'s
 * `steps:` option — `stage.execute` never actually runs here (that's
 * `stage-execute-inngest.e2e.test.ts`'s job). Every other step
 * (`mark-running`, `set-cursor-*`, `mark-completed`/`mark-failed`,
 * `clear-cursor`) executes for real against a real per-suite Postgres DB.
 *
 * The first test is not a throwaway — it's a permanent regression check of
 * the mechanism itself: `steps` mocking is verified (by reading
 * `@inngest/test`/`inngest`'s installed source, not just docs) to resolve
 * `step.invoke` identically to `step.run`, but that's internal-implementation
 * behavior, not a documented public contract. If a future dependency bump
 * breaks it, this test should be the one that fails first and loudest.
 */
describe('run.orchestrate (real Inngest steps, mocked stage.execute, e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;
  let runOrchestrateFn: TestApp['functions'][number];

  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb);
    const fn = testApp.functions.find((f) => f.id() === 'run.orchestrate');
    if (!fn) throw new Error('run.orchestrate function not found');
    runOrchestrateFn = fn;
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
      name: `Run Orchestrate Inngest Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(
      channel.id,
      'Run Orchestrate Inngest Blueprint',
    );
    const version = await blueprints.createVersion(blueprintId, {
      graph,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    return runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 10,
    });
  }

  async function orchestrate(
    runId: string,
    steps: NonNullable<InngestTestEngineNs.Options['steps']>,
  ) {
    const engine = new InngestTestEngine({
      function: runOrchestrateFn,
      events: [{ name: 'run/started', data: { runId } }],
      steps,
    });
    return engine.execute();
  }

  it('proof-of-mechanism: mocking step.invoke resolves run.orchestrate to COMPLETED', async () => {
    const createdRun = await setupRun([stage('only')]);

    const { result, error } = await orchestrate(createdRun.id, [
      { id: 'invoke-stage-only', handler: () => ({ outcome: 'passed', artifactId: 'a1' }) },
    ]);

    expect(error).toBeUndefined();
    expect(result).toEqual({ state: 'COMPLETED' });

    const [row] = await testDb.db.select().from(run).where(eq(run.id, createdRun.id));
    expect(row?.state).toBe('COMPLETED');
  });

  it('invokes stages strictly in blueprint graph order, not alphabetically', async () => {
    // Deliberately non-alphabetical keys — mirrors orderStageExecutions's
    // own unit test's trick, but this proves it at the run.orchestrate
    // function level, not just the extracted pure helper.
    const graph = [stage('outline'), stage('script'), stage('zzz-title')];
    const createdRun = await setupRun(graph);
    const invoked: string[] = [];

    const { result, error } = await orchestrate(
      createdRun.id,
      graph.map((s) => ({
        id: `invoke-stage-${s.key}`,
        handler: () => {
          invoked.push(s.key);
          return { outcome: 'passed', artifactId: `a-${s.key}` };
        },
      })),
    );

    expect(error).toBeUndefined();
    expect(result).toEqual({ state: 'COMPLETED' });
    expect(invoked).toEqual(['outline', 'script', 'zzz-title']);

    const [row] = await testDb.db.select().from(run).where(eq(run.id, createdRun.id));
    expect(row?.state).toBe('COMPLETED');
    expect(row?.cursorStageKey).toBeNull();
  });

  it('a mid-run failure short-circuits later stages entirely', async () => {
    const graph = [stage('one'), stage('two'), stage('three')];
    const createdRun = await setupRun(graph);
    const thirdStageHandler = vi.fn(() => ({ outcome: 'passed', artifactId: 'a-three' }));

    const { result, error } = await orchestrate(createdRun.id, [
      { id: 'invoke-stage-one', handler: () => ({ outcome: 'passed', artifactId: 'a-one' }) },
      { id: 'invoke-stage-two', handler: () => ({ outcome: 'failed', reason: 'check_failed' }) },
      { id: 'invoke-stage-three', handler: thirdStageHandler },
    ]);

    expect(error).toBeUndefined();
    expect(result).toEqual({ state: 'FAILED' });
    expect(thirdStageHandler).not.toHaveBeenCalled();

    const [row] = await testDb.db.select().from(run).where(eq(run.id, createdRun.id));
    expect(row?.state).toBe('FAILED');
    expect(row?.endedAt).not.toBeNull();
  });

  it('resumes past an already-passed stage_execution without re-invoking it', async () => {
    const graph = [stage('outline'), stage('script')];
    const createdRun = await setupRun(graph);
    const outlineExecution = createdRun.stageExecutions.find((e) => e.stageKey === 'outline');
    if (!outlineExecution) throw new Error('stage execution not found');
    await testDb.db
      .update(stageExecution)
      .set({ state: 'passed' })
      .where(eq(stageExecution.id, outlineExecution.id));

    const { result, error } = await orchestrate(createdRun.id, [
      // Registered so a regression of the `state === 'passed'` skip guard
      // fails fast and loudly (a real invoke of an unmocked step id would
      // otherwise hang trying to reach a live Inngest server that doesn't
      // exist in this test), rather than the test just timing out.
      {
        id: 'invoke-stage-outline',
        handler: () => {
          throw new Error('regression: an already-passed stage was re-invoked');
        },
      },
      { id: 'invoke-stage-script', handler: () => ({ outcome: 'passed', artifactId: 'a-script' }) },
    ]);

    expect(error).toBeUndefined();
    expect(result).toEqual({ state: 'COMPLETED' });
  });
});
