import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InngestTestEngine } from '@inngest/test';
import { eq } from 'drizzle-orm';
import type { StageDef } from '@reefcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import type { StageExecuteEventData } from '../../src/orchestration/functions/stage-execute.fn';
import { run, stageAttempt, stageExecution } from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

/**
 * Chunk 5 — dry-run execution (docs/plans/phase-9-editor-templates.md,
 * locked product decision #1): a real `run` row, tagged `dryRun: true`,
 * every stage's model pin forced to the fake provider, driven through the
 * UNCHANGED async Inngest pipeline. Proven the same way
 * `phase2-acceptance.e2e.test.ts` proves the real pipeline: nested
 * `InngestTestEngine`s, mocking `invoke-stage-*` to run a real inner
 * `stage.execute` engine — never calling `StageRunnerService` directly.
 */
describe('dry-run execution (e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;
  let runOrchestrateFn: TestApp['functions'][number];
  let stageExecuteFn: TestApp['functions'][number];

  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb);
    const orchestrateFn = testApp.functions.find((f) => f.id() === 'run.orchestrate');
    const executeFn = testApp.functions.find((f) => f.id() === 'stage.execute');
    if (!orchestrateFn || !executeFn) throw new Error('Inngest functions not found');
    runOrchestrateFn = orchestrateFn;
    stageExecuteFn = executeFn;
  });

  afterAll(async () => {
    try {
      await testApp?.close();
    } finally {
      await testDb.teardown();
    }
  });

  // `draft` is text-modality with NO `model.params.max_tokens` — a real run
  // would fail `RunService.assertTextStagesHaveMaxTokens` (proven below by
  // test 4); a dry run's override injects `max_tokens: 256` so it passes.
  // `illustration` is media-modality, authored with a real-provider-shaped
  // pin ({provider:'openai',...}) that must never actually be called — the
  // override replaces it with the fake provider before it ever reaches
  // `ProviderRegistry`.
  const GRAPH: StageDef[] = [
    {
      key: 'draft',
      label: 'Draft',
      capability: 'text.generate',
      config: {},
      slots: {},
      context: {},
      output: { kind: 'text' },
      checks: [],
      retryLimit: 0,
      model: { provider: 'fake', modelId: 'fake-text-1', params: {} },
    },
    {
      key: 'illustration',
      label: 'Illustration',
      capability: 'image.generate',
      config: {},
      slots: {},
      context: {},
      output: { kind: 'media.image' },
      checks: [],
      retryLimit: 0,
      model: { provider: 'openai', modelId: 'some-real-model', params: {} },
    },
  ];

  async function runThroughRealPipeline(
    runId: string,
    executions: Array<{ id: string; stageKey: string }>,
  ) {
    const invokeSteps = executions.map((execution) => ({
      id: `invoke-stage-${execution.stageKey}`,
      handler: async () => {
        const data: StageExecuteEventData = {
          runId,
          stageExecutionId: execution.id,
          stageKey: execution.stageKey,
        };
        const inner = new InngestTestEngine({
          function: stageExecuteFn,
          events: [{ name: 'stage/execute.requested', data }],
        });
        const { result, error } = await inner.execute();
        if (error) throw error;
        return result;
      },
    }));

    const outerEngine = new InngestTestEngine({
      function: runOrchestrateFn,
      events: [{ name: 'run/started', data: { runId } }],
      steps: invokeSteps,
    });
    return outerEngine.execute();
  }

  it('drives a dry run to completion through the real Inngest pipeline with every stage forced to the fake provider', async () => {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);

    const channel = await channels.create('local', {
      name: `Dry Run Channel ${Date.now()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Dry Run Blueprint');
    const version = await blueprints.createVersion(blueprintId, {
      graph: GRAPH,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    expect(version.runnable).toBe(true);

    const dryRun = await runs.startDryRun(blueprintId, version.version);
    // `RunService.start()` only sends `run/started` — `run.orchestrate`'s
    // `mark-running` step is what actually flips `state` to `RUNNING`
    // (`run.service.ts`'s own doc comment on `start()`), so the state right
    // after `startDryRun()` returns is still `CREATED`.
    expect(dryRun.state).toBe('CREATED');

    const { result, error } = await runThroughRealPipeline(dryRun.id, dryRun.stageExecutions);
    expect(error).toBeUndefined();
    expect(result).toEqual({ state: 'COMPLETED' });

    const [runRow] = await testDb.db.select().from(run).where(eq(run.id, dryRun.id));
    expect(runRow?.state).toBe('COMPLETED');
    expect(runRow?.dryRun).toBe(true);

    const executions = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.runId, dryRun.id));
    expect(executions.every((e) => e.state === 'passed')).toBe(true);

    const attempts = await testDb.db
      .select()
      .from(stageAttempt)
      .where(eq(stageAttempt.stageExecutionId, executions.find((e) => e.stageKey === 'draft')!.id));
    const illustrationAttempts = await testDb.db
      .select()
      .from(stageAttempt)
      .where(
        eq(
          stageAttempt.stageExecutionId,
          executions.find((e) => e.stageKey === 'illustration')!.id,
        ),
      );
    const allAttempts = [...attempts, ...illustrationAttempts];
    expect(allAttempts.length).toBeGreaterThan(0);
    for (const attempt of allAttempts) {
      expect(attempt.outcome).toBe('success');
      expect((attempt.jobHandle as { providerId?: string } | null)?.providerId).toBe('fake');
    }

    // includeDryRuns default (false) excludes it; explicit true includes it.
    const defaultList = await runs.list();
    expect(defaultList.some((r) => r.id === dryRun.id)).toBe(false);
    const withDryRuns = await runs.list(true);
    expect(withDryRuns.some((r) => r.id === dryRun.id)).toBe(true);
  });

  it('throws cleanly for a nonexistent blueprint or version', async () => {
    const runs = testApp.app.get(RunService);
    await expect(runs.startDryRun('nonexistent-blueprint', 1)).rejects.toThrow(/not found/);

    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const channel = await channels.create('local', {
      name: `Dry Run Missing Version Channel ${Date.now()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(
      channel.id,
      'Dry Run Missing Version Blueprint',
    );
    await expect(runs.startDryRun(blueprintId, 999)).rejects.toThrow(/not found/);
  });

  it('does not leak the fake-provider override into a real run: the same graph still fails assertTextStagesHaveMaxTokens', async () => {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);

    const channel = await channels.create('local', {
      name: `Dry Run Regression Channel ${Date.now()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(
      channel.id,
      'Dry Run Regression Blueprint',
    );
    const version = await blueprints.createVersion(blueprintId, {
      graph: GRAPH,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    expect(version.runnable).toBe(true);

    await expect(
      runs.create({
        channelId: channel.id,
        blueprintVersionId: version.id,
        inputs: {},
        roleBindings: {},
        budgetCapUsd: 10,
      }),
    ).rejects.toThrow(/max_tokens/);
  });
});
