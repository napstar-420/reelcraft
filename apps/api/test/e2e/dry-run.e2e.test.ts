import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InngestTestEngine } from '@inngest/test';
import { eq } from 'drizzle-orm';
import { CreateRunDto, type ConfigLayer, type StageDef } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import { RunController } from '../../src/run/run.controller';
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

  // `draft` is text-modality with NO `model.params.max_tokens` — that's a
  // valid, unbounded stage now, not a save/run-time error. `illustration` is
  // media-modality, authored with a real-provider-shaped pin
  // ({provider:'openai',...}) that must never actually be called — the dry
  // run's override replaces it with the fake provider before it ever
  // reaches `ProviderRegistry` (proven below by the leak-regression test).
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

  it('creates a dry run with inputs through POST /runs { dryRun: true }', async () => {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const controller = testApp.app.get(RunController);

    const channel = await channels.create('local', {
      name: `Dry Run Inputs Channel ${Date.now()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Dry Run Inputs Blueprint');
    const version = await blueprints.createVersion(blueprintId, {
      graph: GRAPH,
      inputs: [{ key: 'topic', label: 'Topic', required: true, accepts: { kind: 'text' } }],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });

    const created = await controller.create(
      CreateRunDto.parse({
        channelId: channel.id,
        blueprintVersionId: version.id,
        inputs: { topic: 'otters' },
        budgetCapUsd: 1,
        dryRun: true,
      }),
    );

    const [row] = await testDb.db.select().from(run).where(eq(run.id, created.id));
    expect(row?.dryRun).toBe(true);
    expect(row?.inputs).toEqual({ topic: 'otters' });
    for (const layer of Object.values(row?.resolvedConfig as Record<string, ConfigLayer>)) {
      expect(layer.model?.provider).toBe('fake');
    }
  });

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

    const dryRun = await runs.startDryRun(blueprintId, version);
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
    const defaultList = await runs.list({
      includeDryRuns: false,
      includeDrafts: false,
      limit: 20,
      offset: 0,
    });
    expect(defaultList.items.some((r) => r.id === dryRun.id)).toBe(false);
    const withDryRuns = await runs.list({
      includeDryRuns: true,
      includeDrafts: false,
      limit: 20,
      offset: 0,
    });
    expect(withDryRuns.items.some((r) => r.id === dryRun.id)).toBe(true);
  });

  it('throws cleanly for a nonexistent blueprint or version', async () => {
    const runs = testApp.app.get(RunService);
    await expect(runs.startDryRun('nonexistent-blueprint', { major: 1, minor: 0 })).rejects.toThrow(
      /not found/,
    );

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
    await expect(runs.startDryRun(blueprintId, { major: 999, minor: 0 })).rejects.toThrow(
      /not found/,
    );
  });

  it('does not leak the fake-provider override into a real run', async () => {
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

    const created = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });

    const [row] = await testDb.db.select().from(run).where(eq(run.id, created.id));
    const resolvedConfig = row?.resolvedConfig as Record<
      string,
      { model?: { provider?: string; params?: object } }
    >;
    expect(resolvedConfig.draft?.model?.params).not.toHaveProperty('max_tokens');
    expect(resolvedConfig.illustration?.model?.provider).toBe('openai');
  });
});
