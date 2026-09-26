import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InngestTestEngine } from '@inngest/test';
import { eq } from 'drizzle-orm';
import type { StageDef } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import type { StageExecuteEventData } from '../../src/orchestration/functions/stage-execute.fn';
import { stageAttempt, stageExecution } from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

/** A finished run's stage output and stage log, read back through the same
 * RunService methods the `/output` and `/logs` endpoints call. */
describe('stage output and stage logs (e2e)', () => {
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

  const GRAPH: StageDef[] = [
    {
      key: 'draft',
      label: 'Draft',
      capability: 'text.generate',
      config: {},
      slots: {},
      context: {},
      instructions: { template: 'Write a one-line greeting.' },
      output: { kind: 'text' },
      checks: [],
      retryLimit: 0,
      model: { provider: 'fake', modelId: 'fake-text-1', params: {} },
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
    return new InngestTestEngine({
      function: runOrchestrateFn,
      events: [{ name: 'run/started', data: { runId } }],
      steps: invokeSteps,
    }).execute();
  }

  it('returns the current output and an ordered log of what the stage did', async () => {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);

    const channel = await channels.create('local', {
      name: `Output Logs Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Output Logs Blueprint');
    const version = await blueprints.createVersion(blueprintId, {
      graph: GRAPH,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    const dryRun = await runs.startDryRun(blueprintId, version.version);
    const { error } = await runThroughRealPipeline(dryRun.id, dryRun.stageExecutions);
    expect(error).toBeUndefined();

    const output = await runs.stageOutput(dryRun.id, 'draft');
    expect(output.items).toHaveLength(1);
    expect(output.items[0]!.itemIndex).toBeNull();
    expect(output.items[0]!.artifact.kind).toBe('text');
    expect(output.items[0]!.artifact.data).toMatchObject({ text: expect.any(String) });

    const events = await runs.listStageEvents(dryRun.id, 'draft');
    const types = events.map((event) => event.type);
    for (const type of [
      'attempt.started',
      'prompt.rendered',
      'model.selected',
      'job.submitted',
      'job.completed',
      'attempt.finished',
    ]) {
      expect(types).toContain(type);
    }
    expect(types.indexOf('attempt.started')).toBeLessThan(types.indexOf('attempt.finished'));
    expect([...events.map((e) => e.id)].sort()).toEqual(events.map((e) => e.id));
    const finished = events.find((event) => event.type === 'attempt.finished');
    expect(finished?.level).toBe('info');
    expect(finished?.data).toMatchObject({ outcome: 'success' });
    const prompt = events.find((event) => event.type === 'prompt.rendered');
    expect(prompt?.data).toMatchObject({ prompt: expect.stringContaining('one-line greeting') });

    const [execution] = await testDb.db
      .select({ id: stageExecution.id })
      .from(stageExecution)
      .where(eq(stageExecution.runId, dryRun.id));
    const [attempt] = await testDb.db
      .select({ durationMs: stageAttempt.durationMs })
      .from(stageAttempt)
      .where(eq(stageAttempt.stageExecutionId, execution!.id));
    expect(attempt?.durationMs).toEqual(expect.any(Number));
  });

  it('returns no items for a stage with no current output', async () => {
    const runs = testApp.app.get(RunService);
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const channel = await channels.create('local', {
      name: `Output Empty Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Output Empty Blueprint');
    const version = await blueprints.createVersion(blueprintId, {
      graph: GRAPH,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    const dryRun = await runs.startDryRun(blueprintId, version.version);
    const output = await runs.stageOutput(dryRun.id, 'draft');
    expect(output.items).toEqual([]);
    expect(await runs.listStageEvents(dryRun.id, 'draft')).toEqual([]);
  });
});
