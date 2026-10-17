import { InngestTestEngine } from '@inngest/test';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { StageDef } from '@reelcraft/shared';
import { createTestDb, type TestDb } from '../support/test-db';
import { buildTestApp, type TestApp } from '../support/build-app';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { ChannelService } from '../../src/channel/channel.service';
import { RunService } from '../../src/run/run.service';
import { RunStagePlanService } from '../../src/run/run-stage-plan.service';
import { BindingResolverService } from '../../src/artifact/binding-resolver.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import {
  run,
  stageExecution,
  runWakeup,
  artifact,
  runMemory,
  stageAttempt,
} from '../../src/db/schema';
import { ulid } from '../../src/common/ulid';
const stage = (key: string, deps: string[] = []) =>
  StageDef.parse({
    key,
    label: key,
    dependsOn: deps,
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    checks: [],
    output: { kind: 'text' },
    model: { provider: 'fake', modelId: 'fake-text-1' },
  });
describe('DAG presentation, availability and provenance', () => {
  let db: TestDb, app: TestApp;
  beforeAll(async () => {
    db = await createTestDb();
    app = await buildTestApp(db);
  });
  afterAll(async () => {
    await app?.close();
    await db?.teardown();
  });
  it('persists shared layout, blocks disabled outputs, allows manual execution and scopes attempt reads', async () => {
    const channel = await app.app
      .get(ChannelService)
      .create('local', { name: 'Inspection', theme: {}, defaults: {} });
    const blueprints = app.app.get(BlueprintService);
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Inspection');
    const graph = [stage('source'), stage('consumer', ['source']), stage('independent')];
    const presentation = {
      positions: { source: { x: 125, y: 76 } },
      branchNames: { source: 'Narration' },
    };
    const version = await blueprints.createVersion(blueprintId, {
      graph,
      presentation,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    expect(version.presentation).toEqual(presentation);
    const runs = app.app.get(RunService);
    const created = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 10,
      rerunStageKeys: [],
    });
    await db.db.update(run).set({ state: 'IDLE' }).where(eq(run.id, created.id));
    await db.db
      .update(runWakeup)
      .set({ claimedAt: new Date().toISOString() })
      .where(eq(runWakeup.runId, created.id));
    const execution = created.stageExecutions.find((e) => e.stageKey === 'source')!;
    const artifactId = ulid();
    await db.db.insert(artifact).values({
      id: artifactId,
      runId: created.id,
      producerStageKey: 'source',
      kind: 'text',
      reproLevel: 'exact',
      data: { text: 'preserved' },
    });
    await db.db.insert(runMemory).values({
      id: ulid(),
      runId: created.id,
      memKey: 'source',
      version: 1,
      writtenBy: 'source',
      kind: 'text',
      data: { text: 'preserved' },
    });
    await db.db
      .update(stageExecution)
      .set({ state: 'passed', outputArtifactId: artifactId })
      .where(eq(stageExecution.id, execution.id));
    const disabledGraph = graph.map((s) => (s.key === 'source' ? { ...s, disabled: true } : s));
    const draft = await blueprints.createVersion(
      blueprintId,
      {
        graph: disabledGraph,
        presentation,
        inputs: [],
        roles: [],
        defaults: {},
        budget: { runCapUsd: 10 },
      },
      { draft: true },
    );
    expect(draft.runnable).toBe(false);
    expect(draft.validation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('Disabled ancestor: source') }),
      ]),
    );
    const plans = app.app.get(RunStagePlanService);
    const request = {
      blueprintVersionId: draft.id,
      stageKey: 'source',
      action: 'rerun' as const,
      scope: 'stage' as const,
      mode: 'reuse' as const,
    };
    const plan = await plans.preview(created.id, request);
    expect(plan.blockedReason).toBeNull();
    expect(plan.availabilityChangedStageKeys).toEqual(['source']);
    await plans.confirm(created.id, { ...request, previewToken: plan.previewToken });
    await db.db.update(run).set({ state: 'IDLE' }).where(eq(run.id, created.id));
    await db.db
      .update(runWakeup)
      .set({ claimedAt: new Date().toISOString() })
      .where(eq(runWakeup.runId, created.id));
    const after = await runs.get(created.id);
    expect(
      after.stageExecutions.find((e) => e.stageKey === 'consumer')?.availableActions?.blockedReason,
    ).toContain('Disabled ancestor');
    const resolver = app.app.get(BindingResolverService);
    await expect(
      resolver.resolve(
        { from: 'stage', stageKey: 'source' },
        { runId: created.id, stageKey: 'consumer', inputs: {} },
      ),
    ).rejects.toThrow('Disabled stage');
    // Reinsert memory after rerun invalidation to test availability independently of freshness.
    await db.db.insert(runMemory).values({
      id: ulid(),
      runId: created.id,
      memKey: 'source',
      version: 3,
      writtenBy: 'source',
      kind: 'text',
      data: { text: 'new' },
    });
    await expect(
      resolver.resolve(
        { from: 'memory', key: 'source' },
        { runId: created.id, stageKey: 'consumer', inputs: {} },
      ),
    ).rejects.toThrow('Disabled stage');
    await expect(
      app.app.get(StageRunnerService).loadStageContext(created.id, 'consumer'),
    ).rejects.toThrow('Disabled ancestor');
    await expect(
      app.app.get(StageRunnerService).loadStageContext(created.id, 'source'),
    ).resolves.toMatchObject({ stage: { disabled: true } });
    const attemptId = ulid();
    await db.db.insert(stageAttempt).values({
      id: attemptId,
      stageExecutionId: execution.id,
      attemptNo: 1,
      outcome: 'qc_failed',
      resolvedInputs: { slots: { text: 'recorded' }, provenance: {} },
      renderedPrompt: 'original prompt',
      durationMs: 1234,
      artifactId,
    });
    expect(await runs.stageAttemptDetail(created.id, 'source', attemptId)).toMatchObject({
      id: attemptId,
      renderedPrompt: 'original prompt',
      durationMs: 1234,
      artifact: { id: artifactId },
    });
    await expect(runs.stageAttemptDetail(created.id, 'consumer', attemptId)).rejects.toThrow(
      'Attempt not found',
    );
    expect((await runs.stageOutput(created.id, 'source')).items).toEqual([]);
    await db.db.update(run).set({ state: 'RUNNING' }).where(eq(run.id, created.id));
    const result = await new InngestTestEngine({
      function: app.functions.find((fn) => fn.id() === 'stage.execute')!,
      events: [
        {
          name: 'stage/execute.requested',
          data: {
            runId: created.id,
            stageKey: 'source',
            stageExecutionId: execution.id,
            executionEpoch: 1,
          },
        },
      ],
    }).execute();
    expect(result.error).toBeUndefined();
    const manualOutput = (await runs.stageOutput(created.id, 'source')).items[0]!;
    expect(manualOutput.artifact.id).not.toBe(artifactId);
    expect(
      (await runs.get(created.id)).stageExecutions.find((s) => s.stageKey === 'source')
        ?.outputAvailable,
    ).toBe(false);
    await expect(
      resolver.resolve(
        { from: 'stage', stageKey: 'source' },
        { runId: created.id, stageKey: 'consumer', inputs: {} },
      ),
    ).rejects.toThrow('Disabled stage');
    await db.db.update(run).set({ state: 'IDLE' }).where(eq(run.id, created.id));
    const enabledVersion = await blueprints.createVersion(
      blueprintId,
      { graph, presentation, inputs: [], roles: [], defaults: {}, budget: { runCapUsd: 10 } },
      { draft: true },
    );
    const enabledRequest = {
      blueprintVersionId: enabledVersion.id,
      stageKey: 'consumer',
      action: 'continue' as const,
      scope: 'stage' as const,
      mode: 'reuse' as const,
    };
    const enabledPlan = await plans.preview(created.id, enabledRequest);
    expect(enabledPlan.blockedReason).toBeNull();
    await plans.confirm(created.id, { ...enabledRequest, previewToken: enabledPlan.previewToken });
    expect((await runs.stageOutput(created.id, 'source')).items[0]?.artifact.id).toBe(
      manualOutput.artifact.id,
    );
    await expect(
      resolver.resolve(
        { from: 'stage', stageKey: 'source' },
        { runId: created.id, stageKey: 'consumer', inputs: {} },
      ),
    ).resolves.toHaveProperty('value');
    // old artifact remains historical after rerun
  });
});
