import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InngestTestEngine } from '@inngest/test';
import { eq, inArray } from 'drizzle-orm';
import type { RetryScope, StageDef } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import { RunActionService } from '../../src/run/run-action.service';
import type { StageExecuteEventData } from '../../src/orchestration/functions/stage-execute.fn';
import { artifact, blob, stageExecution } from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

/**
 * Re-running a finished stage of a COMPLETED run in place, per retry scope.
 * Graph: cover (image, reads nothing) → topics (reads nothing) → selector
 * (reads topics via `prev`).
 */
describe('stage re-run scopes (e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;
  let runOrchestrateFn: TestApp['functions'][number];
  let stageExecuteFn: TestApp['functions'][number];

  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb);
    runOrchestrateFn = testApp.functions.find((f) => f.id() === 'run.orchestrate')!;
    stageExecuteFn = testApp.functions.find((f) => f.id() === 'stage.execute')!;
  });

  afterAll(async () => {
    try {
      await testApp?.close();
    } finally {
      await testDb.teardown();
    }
  });

  const base = { config: {}, slots: {}, checks: [], retryLimit: 0 };
  const graph: StageDef[] = [
    {
      ...base,
      key: 'cover',
      label: 'Cover',
      capability: 'image.generate',
      context: {},
      output: { kind: 'media.image' },
      model: { provider: 'fake', modelId: 'fake-image-1', params: {} },
    },
    {
      ...base,
      key: 'topics',
      label: 'Topics',
      capability: 'text.generate',
      context: {},
      output: {
        kind: 'data',
        schema: {
          type: 'object',
          properties: { topics: { type: 'array', items: { type: 'string' } } },
          required: ['topics'],
        },
      },
      model: {
        provider: 'fake',
        modelId: 'fake-text-1',
        params: { max_tokens: 64, fakeOutput: { topics: ['ocean life', 'coral reefs'] } },
      },
    },
    {
      ...base,
      key: 'selector',
      label: 'Selector',
      capability: 'text.generate',
      instructions: { template: 'Pick the best topic from {{ topics }}.' },
      context: { topics: { from: 'prev', path: 'topics' } },
      output: { kind: 'text' },
      model: {
        provider: 'fake',
        modelId: 'fake-text-1',
        params: { max_tokens: 64, fakeOutput: { text: 'ocean life' } },
      },
    },
  ];

  async function completedRun() {
    const channel = await testApp.app.get(ChannelService).create('local', {
      name: `Rerun scope ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprints = testApp.app.get(BlueprintService);
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Rerun Scope Blueprint');
    const version = await blueprints.createVersion(blueprintId, {
      graph,
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
    const steps = created.stageExecutions.map((execution) => ({
      id: `invoke-stage-${execution.stageKey}`,
      handler: async () => {
        const data: StageExecuteEventData = {
          runId: created.id,
          stageExecutionId: execution.id,
          stageKey: execution.stageKey,
        };
        const { result, error } = await new InngestTestEngine({
          function: stageExecuteFn,
          events: [{ name: 'stage/execute.requested', data }],
        }).execute();
        if (error) throw error;
        return result;
      },
    }));
    const { result } = await new InngestTestEngine({
      function: runOrchestrateFn,
      events: [{ name: 'run/started', data: { runId: created.id } }],
      steps,
    }).execute();
    expect(result).toEqual({ state: 'COMPLETED' });
    return created.id;
  }

  async function rerun(runId: string, stageKey: string, scope: RetryScope) {
    const actions = testApp.app.get(RunActionService);
    const preview = await actions.previewStageRetry(runId, stageKey, undefined, scope);
    await actions.confirmStageRetry(runId, stageKey, preview.previewToken, undefined, scope);
    const rows = await testDb.db
      .select({ stageKey: stageExecution.stageKey, state: stageExecution.state })
      .from(stageExecution)
      .where(eq(stageExecution.runId, runId));
    return Object.fromEntries(rows.map((row) => [row.stageKey, row.state]));
  }

  it('"stage" re-runs only that stage, even when a later stage read its output', async () => {
    const runId = await completedRun();
    expect(await rerun(runId, 'topics', 'stage')).toEqual({
      cover: 'passed',
      topics: 'stale',
      selector: 'passed',
    });
  });

  it('"dependents" re-runs the stage and the stages that read it', async () => {
    const runId = await completedRun();
    expect(await rerun(runId, 'topics', 'dependents')).toEqual({
      cover: 'passed',
      topics: 'stale',
      selector: 'stale',
    });
  });

  it('"downstream" re-runs the stage and every later stage, readers or not', async () => {
    const runId = await completedRun();
    expect(await rerun(runId, 'cover', 'downstream')).toEqual({
      cover: 'stale',
      topics: 'stale',
      selector: 'stale',
    });
  });

  it('"stage" keeps the old blob out of GC, since later stages may still reference it', async () => {
    const runId = await completedRun();
    await rerun(runId, 'cover', 'stage');
    const coverArtifacts = await testDb.db
      .select({ blobId: artifact.blobId })
      .from(artifact)
      .where(eq(artifact.runId, runId));
    const blobIds = coverArtifacts.map((row) => row.blobId).filter((id): id is string => !!id);
    expect(blobIds.length).toBeGreaterThan(0);
    const blobs = await testDb.db
      .select({ gcEligible: blob.gcEligible })
      .from(blob)
      .where(inArray(blob.id, blobIds));
    expect(blobs.every((row) => !row.gcEligible)).toBe(true);
  });

  it('rejects a confirm whose scope differs from the previewed one', async () => {
    const runId = await completedRun();
    const actions = testApp.app.get(RunActionService);
    const preview = await actions.previewStageRetry(runId, 'topics', undefined, 'stage');
    await expect(
      actions.confirmStageRetry(runId, 'topics', preview.previewToken, undefined, 'downstream'),
    ).rejects.toThrow();
  });
});
