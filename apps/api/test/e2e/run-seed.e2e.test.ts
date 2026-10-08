import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { InngestTestEngine } from '@inngest/test';
import { and, eq } from 'drizzle-orm';
import type { InputDef, StageDef } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import { RunActionService } from '../../src/run/run-action.service';
import type { StageExecuteEventData } from '../../src/orchestration/functions/stage-execute.fn';
import {
  artifact,
  blob,
  run,
  stageAttempt,
  stageEvent,
  stageExecution,
} from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

/**
 * The "run a stage without re-running upstream" feature (see the
 * run-stages-from-canvas plan): `RunService.create`'s `seedFromRunId` copies
 * a source run's still-valid finished stages into a brand-new run at $0
 * cost, marks them `passed`, and lets `run.orchestrate`'s existing `passed`/
 * `skipped` skip do the rest — proven here the same way every other
 * orchestration e2e test proves it, through the REAL `run.orchestrate`/
 * `stage.execute` Inngest functions (`phase2-acceptance.e2e.test.ts`'s
 * nested-`InngestTestEngine` technique), not direct service calls.
 *
 * A key trick used below: `driveRun`'s `onlyKeys` param mocks
 * `invoke-stage-*` ONLY for the stages actually expected to execute. If the
 * skip logic ever regressed and `run.orchestrate` tried to invoke a reused
 * or skipped stage anyway, `InngestTestEngine` would fail with "no mock for
 * step X" — so a clean `COMPLETED` result is itself proof the others were
 * never invoked, not just an absence-of-assertion.
 */
describe('seeded runs — run a stage without re-running upstream (e2e)', () => {
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

  function topicsStage(): StageDef {
    return {
      key: 'topics',
      label: 'Topics',
      capability: 'text.generate',
      config: {},
      slots: {},
      context: {},
      output: {
        kind: 'data',
        schema: {
          type: 'object',
          properties: { topics: { type: 'array', items: { type: 'string' } } },
          required: ['topics'],
        },
      },
      checks: [],
      retryLimit: 0,
      model: {
        provider: 'fake',
        modelId: 'fake-text-1',
        params: {
          max_tokens: 64,
          fakeOutput: { topics: ['ocean life', 'coral reefs', 'tide pools'] },
        },
      },
    };
  }

  /** No `fakeOutput` — `fake-image-1` falls back to its deterministic PNG
   * fixture, giving this stage a real `blobId` to prove blob-sharing with. */
  function coverStage(): StageDef {
    return {
      key: 'cover',
      label: 'Cover',
      capability: 'image.generate',
      config: {},
      slots: {},
      context: {},
      output: { kind: 'media.image' },
      checks: [],
      retryLimit: 0,
      model: { provider: 'fake', modelId: 'fake-image-1', params: {} },
    };
  }

  /** Binds `{from:'prev'}` onto `topics` so its `stage_attempt.resolvedInputs`
   * carries a real provenance entry — this is what the provenance-remap test
   * needs to prove `copyReusedStages` rewrote it onto the new run's copy. */
  function selectorStage(): StageDef {
    return {
      key: 'selector',
      label: 'Selector',
      capability: 'text.generate',
      instructions: { template: 'Pick the best topic from {{ topics }}.' },
      config: {},
      slots: {},
      context: { topics: { from: 'prev', path: 'topics' } },
      output: { kind: 'text' },
      checks: [],
      retryLimit: 0,
      model: {
        provider: 'fake',
        modelId: 'fake-text-1',
        params: { max_tokens: 64, fakeOutput: { text: 'ocean life' } },
      },
    };
  }

  function scriptStage(): StageDef {
    return {
      key: 'script',
      label: 'Script',
      capability: 'text.generate',
      config: {},
      slots: {},
      context: {},
      output: { kind: 'text' },
      checks: [],
      retryLimit: 0,
      model: {
        provider: 'fake',
        modelId: 'fake-text-1',
        params: { max_tokens: 64, fakeOutput: { text: 'A short script about ocean life.' } },
      },
    };
  }

  async function makeChannel(label: string) {
    const channels = testApp.app.get(ChannelService);
    return channels.create('local', {
      name: `${label} ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
  }

  /** Only builds `invoke-stage-*` mocks for `onlyKeys` — see the class
   * comment for why omitting the rest is itself an assertion. */
  async function driveRun(
    runId: string,
    executions: Array<{ id: string; stageKey: string }>,
    onlyKeys?: string[],
  ) {
    const targets = onlyKeys ? executions.filter((e) => onlyKeys.includes(e.stageKey)) : executions;
    const invokeSteps = targets.map((execution) => ({
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

  it('copies a still-valid prefix into a new run at $0 and only executes the appended stage', async () => {
    const runs = testApp.app.get(RunService);
    const blueprints = testApp.app.get(BlueprintService);
    const channel = await makeChannel('Seed Main');
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Seed Main Blueprint');

    const v1 = await blueprints.createVersion(blueprintId, {
      graph: [topicsStage(), coverStage()],
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    expect(v1.runnable).toBe(true);

    const run1 = await runs.create({
      channelId: channel.id,
      blueprintVersionId: v1.id,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });
    const { error: run1Error, result: run1Result } = await driveRun(run1.id, run1.stageExecutions);
    expect(run1Error).toBeUndefined();
    expect(run1Result).toEqual({ state: 'COMPLETED' });

    const [run1Row] = await testDb.db.select().from(run).where(eq(run.id, run1.id));
    const run1Artifacts = await testDb.db
      .select()
      .from(artifact)
      .where(eq(artifact.runId, run1.id));
    const run1Cover = run1Artifacts.find((a) => a.producerStageKey === 'cover')!;
    expect(run1Cover.blobId).not.toBeNull();

    const v2 = await blueprints.createVersion(blueprintId, {
      graph: [topicsStage(), coverStage(), scriptStage()],
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    expect(v2.runnable).toBe(true);

    const run2 = await runs.create({
      channelId: channel.id,
      blueprintVersionId: v2.id,
      seedFromRunId: run1.id,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });

    // Reused instantly — before this run has even started.
    const topicsExec = run2.stageExecutions.find((e) => e.stageKey === 'topics')!;
    const coverExec = run2.stageExecutions.find((e) => e.stageKey === 'cover')!;
    const scriptExec = run2.stageExecutions.find((e) => e.stageKey === 'script')!;
    expect(topicsExec.state).toBe('passed');
    expect(coverExec.state).toBe('passed');
    expect(Number(topicsExec.costUsd)).toBe(0);
    expect(Number(coverExec.costUsd)).toBe(0);
    expect(scriptExec.state).toBe('pending');

    const reuseEvents = await testDb.db
      .select()
      .from(stageEvent)
      .where(eq(stageEvent.runId, run2.id));
    expect(
      reuseEvents.filter((e) => e.type === 'stage.reused').map((e) => e.stageExecutionId),
    ).toEqual(expect.arrayContaining([topicsExec.id, coverExec.id]));

    const run2Artifacts = await testDb.db
      .select()
      .from(artifact)
      .where(eq(artifact.runId, run2.id));
    const run2Cover = run2Artifacts.find((a) => a.producerStageKey === 'cover')!;
    expect(run2Cover.id).not.toBe(run1Cover.id); // own copy, not a shared row
    expect(run2Cover.blobId).toBe(run1Cover.blobId); // but the SAME underlying object
    expect(run2Cover.stale).toBe(false);
    expect(Number(run2Cover.costUsd)).toBe(0);

    const run2Attempts = await testDb.db
      .select()
      .from(stageAttempt)
      .where(eq(stageAttempt.stageExecutionId, coverExec.id));
    expect(run2Attempts).toHaveLength(1);
    expect(run2Attempts[0]?.outcome).toBe('success');
    expect(run2Attempts[0]?.phase).toBe('settled');
    expect(run2Attempts[0]?.artifactId).toBe(run2Cover.id); // remapped, not run1's id

    // Only `script` gets an invoke mock — topics/cover must never be invoked.
    const { error: run2Error, result: run2Result } = await driveRun(run2.id, run2.stageExecutions, [
      'script',
    ]);
    expect(run2Error).toBeUndefined();
    expect(run2Result).toEqual({ state: 'COMPLETED' });

    const [run2Row] = await testDb.db.select().from(run).where(eq(run.id, run2.id));
    expect(run2Row?.state).toBe('COMPLETED');
    // Only script's own attempt cost — not topics+cover's cost added again.
    expect(Number(run2Row?.spentUsd)).toBeCloseTo(0.001, 5);

    const [refetchedRun1] = await testDb.db.select().from(run).where(eq(run.id, run1.id));
    expect(refetchedRun1?.spentUsd).toBe(run1Row?.spentUsd); // untouched by run2
  });

  it('untilStageKey creates the tail as skipped and completes without executing anything', async () => {
    const runs = testApp.app.get(RunService);
    const blueprints = testApp.app.get(BlueprintService);
    const channel = await makeChannel('Seed Until');
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Seed Until Blueprint');

    const v1 = await blueprints.createVersion(blueprintId, {
      graph: [topicsStage(), coverStage()],
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    const run1 = await runs.create({
      channelId: channel.id,
      blueprintVersionId: v1.id,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });
    await driveRun(run1.id, run1.stageExecutions);

    const v2 = await blueprints.createVersion(blueprintId, {
      graph: [topicsStage(), coverStage(), scriptStage()],
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    const run2 = await runs.create({
      channelId: channel.id,
      blueprintVersionId: v2.id,
      seedFromRunId: run1.id,
      untilStageKey: 'cover',
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });

    expect(run2.stageExecutions.find((e) => e.stageKey === 'topics')?.state).toBe('passed');
    expect(run2.stageExecutions.find((e) => e.stageKey === 'cover')?.state).toBe('passed');
    expect(run2.stageExecutions.find((e) => e.stageKey === 'script')?.state).toBe('skipped');

    // No mocks at all — if the orchestrator tried to invoke ANYTHING, this fails.
    const { error, result } = await driveRun(run2.id, run2.stageExecutions, []);
    expect(error).toBeUndefined();
    expect(result).toEqual({ state: 'COMPLETED' });

    const [run2Row] = await testDb.db.select().from(run).where(eq(run.id, run2.id));
    expect(run2Row?.state).toBe('COMPLETED');
    expect(Number(run2Row?.spentUsd)).toBe(0);
  });

  it('retrying a reused stage inside a seeded run correctly invalidates a reused downstream stage via remapped provenance', async () => {
    const runs = testApp.app.get(RunService);
    const blueprints = testApp.app.get(BlueprintService);
    const actions = testApp.app.get(RunActionService);
    const channel = await makeChannel('Seed Remap');
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Seed Remap Blueprint');

    const graph = [topicsStage(), selectorStage()];
    const v1 = await blueprints.createVersion(blueprintId, {
      graph,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    const run1 = await runs.create({
      channelId: channel.id,
      blueprintVersionId: v1.id,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });
    await driveRun(run1.id, run1.stageExecutions);

    // Same version — a full clone: both stages should be reused.
    const run2 = await runs.create({
      channelId: channel.id,
      blueprintVersionId: v1.id,
      seedFromRunId: run1.id,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });
    expect(run2.stageExecutions.every((e) => e.state === 'passed')).toBe(true);

    // Nothing to invoke — the whole graph was reused.
    const { error, result } = await driveRun(run2.id, run2.stageExecutions, []);
    expect(error).toBeUndefined();
    expect(result).toEqual({ state: 'COMPLETED' });

    const selectorExec2 = run2.stageExecutions.find((e) => e.stageKey === 'selector')!;
    const run2SelectorAttempt = (
      await testDb.db
        .select()
        .from(stageAttempt)
        .where(eq(stageAttempt.stageExecutionId, selectorExec2.id))
    )[0]!;
    const resolvedInputs = run2SelectorAttempt.resolvedInputs as Record<
      string,
      { artifactId?: string }
    >;
    // The remap proof, directly: selector's provenance points at RUN2's own
    // topics artifact, not run1's original one.
    const run2Topics = (
      await testDb.db.select().from(artifact).where(eq(artifact.runId, run2.id))
    ).find((a) => a.producerStageKey === 'topics')!;
    expect(Object.values(resolvedInputs).some((p) => p.artifactId === run2Topics.id)).toBe(true);

    const preview = await actions.previewStageRetry(run2.id, 'topics');
    await actions.confirmStageRetry(run2.id, 'topics', preview.previewToken);

    const [selectorAfter] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, selectorExec2.id));
    expect(selectorAfter?.state).toBe('stale');

    // run1 is completely untouched by anything done to its clone.
    const run1Selector = run1.stageExecutions.find((e) => e.stageKey === 'selector')!;
    const [run1SelectorAfter] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, run1Selector.id));
    expect(run1SelectorAfter?.state).toBe('passed');
  });

  it('shares a blob across runs and only marks it GC-eligible once no run still has an active artifact on it', async () => {
    const runs = testApp.app.get(RunService);
    const blueprints = testApp.app.get(BlueprintService);
    const actions = testApp.app.get(RunActionService);
    const channel = await makeChannel('Seed Blob GC');
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Seed Blob GC Blueprint');

    const graph = [topicsStage(), coverStage()];
    const v1 = await blueprints.createVersion(blueprintId, {
      graph,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    const run1 = await runs.create({
      channelId: channel.id,
      blueprintVersionId: v1.id,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });
    await driveRun(run1.id, run1.stageExecutions);

    const run2 = await runs.create({
      channelId: channel.id,
      blueprintVersionId: v1.id,
      seedFromRunId: run1.id,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });
    await driveRun(run2.id, run2.stageExecutions, []);

    const run1Cover = (
      await testDb.db.select().from(artifact).where(eq(artifact.runId, run1.id))
    ).find((a) => a.producerStageKey === 'cover')!;
    const blobId = run1Cover.blobId!;

    // Retire run1's copy — run2's copy still actively points at the same blob.
    const preview1 = await actions.previewStageRetry(run1.id, 'cover');
    await actions.confirmStageRetry(run1.id, 'cover', preview1.previewToken);
    const [blobAfterFirst] = await testDb.db.select().from(blob).where(eq(blob.id, blobId));
    expect(blobAfterFirst?.gcEligible).toBe(false);

    // Retire run2's copy too — now nothing references the blob.
    const preview2 = await actions.previewStageRetry(run2.id, 'cover');
    await actions.confirmStageRetry(run2.id, 'cover', preview2.previewToken);
    const [blobAfterSecond] = await testDb.db.select().from(blob).where(eq(blob.id, blobId));
    expect(blobAfterSecond?.gcEligible).toBe(true);
  });

  it('seeds a run whose source had a text input, without duplicating the input artifact', async () => {
    const runs = testApp.app.get(RunService);
    const blueprints = testApp.app.get(BlueprintService);
    const channel = await makeChannel('Seed Input');
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Seed Input Blueprint');
    const inputDefs: InputDef[] = [
      { key: 'style', label: 'Style', required: false, accepts: { kind: 'text' } },
    ];
    const v1 = await blueprints.createVersion(blueprintId, {
      graph: [topicsStage()],
      inputs: inputDefs,
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    const run1 = await runs.create({
      channelId: channel.id,
      blueprintVersionId: v1.id,
      inputs: { style: 'documentary' },
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });
    await driveRun(run1.id, run1.stageExecutions);

    const run2 = await runs.create({
      channelId: channel.id,
      blueprintVersionId: v1.id,
      seedFromRunId: run1.id,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });

    const inputs = await testDb.db
      .select()
      .from(artifact)
      .where(and(eq(artifact.runId, run2.id), eq(artifact.producerStageKey, '$input:style')));
    expect(inputs.filter((a) => !a.stale)).toHaveLength(1);
    expect(inputs[0]?.data).toEqual({ text: 'documentary' });
  });

  it('rejects a seed from a mismatched blueprint, a conflicting input value, and an unknown stage key', async () => {
    const runs = testApp.app.get(RunService);
    const blueprints = testApp.app.get(BlueprintService);
    const channel = await makeChannel('Seed Validation');
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Seed Validation Blueprint');
    const inputDefs: InputDef[] = [
      { key: 'style', label: 'Style', required: false, accepts: { kind: 'text' } },
    ];

    const v1 = await blueprints.createVersion(blueprintId, {
      graph: [topicsStage()],
      inputs: inputDefs,
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    const run1 = await runs.create({
      channelId: channel.id,
      blueprintVersionId: v1.id,
      inputs: { style: 'documentary' },
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });
    await driveRun(run1.id, run1.stageExecutions);

    const otherBlueprintId = await blueprints.ensureBlueprint(
      channel.id,
      'Seed Validation Other Blueprint',
    );
    const otherVersion = await blueprints.createVersion(otherBlueprintId, {
      graph: [topicsStage()],
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    await expect(
      runs.create({
        channelId: channel.id,
        blueprintVersionId: otherVersion.id,
        seedFromRunId: run1.id,
        inputs: {},
        roleBindings: {},
        rerunStageKeys: [],
        budgetCapUsd: 10,
      }),
    ).rejects.toThrow(ConflictException);

    await expect(
      runs.create({
        channelId: channel.id,
        blueprintVersionId: v1.id,
        seedFromRunId: run1.id,
        inputs: { style: 'cinematic' },
        roleBindings: {},
        rerunStageKeys: [],
        budgetCapUsd: 10,
      }),
    ).rejects.toThrow(ConflictException);

    await expect(
      runs.create({
        channelId: channel.id,
        blueprintVersionId: v1.id,
        inputs: {},
        roleBindings: {},
        rerunStageKeys: [],
        budgetCapUsd: 10,
        untilStageKey: 'does-not-exist',
      }),
    ).rejects.toThrow(ConflictException);

    await expect(
      runs.create({
        channelId: channel.id,
        blueprintVersionId: v1.id,
        inputs: {},
        roleBindings: {},
        rerunStageKeys: ['does-not-exist'],
        budgetCapUsd: 10,
      }),
    ).rejects.toThrow(ConflictException);
  });
});
