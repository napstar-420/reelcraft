import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { InngestTestEngine } from '@inngest/test';
import { and, eq } from 'drizzle-orm';
import { StageDef, type InputDef } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunStagePlanService } from '../../src/run/run-stage-plan.service';
import { RunService } from '../../src/run/run.service';
import { RunWakeupClaimService } from '../../src/run/run-wakeup-claim.service';
import { RunActionService } from '../../src/run/run-action.service';
import { HumanActionService } from '../../src/run/human-action.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import type { StageExecuteEventData } from '../../src/orchestration/functions/stage-execute.fn';
import {
  artifact,
  blob,
  run,
  runWakeup,
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
    const [owner] = await testDb.db.select().from(run).where(eq(run.id, runId));
    const [wakeup] = await testDb.db
      .select()
      .from(runWakeup)
      .where(and(eq(runWakeup.runId, runId), eq(runWakeup.expectedRevision, owner!.revision)))
      .limit(1);
    const eventData = {
      runId,
      executionEpoch: owner!.executionEpoch,
      ...(wakeup &&
        !wakeup.claimedAt && {
          wakeupId: wakeup.id,
          action: wakeup.action,
          sourceState: wakeup.sourceState,
          expectedRevision: wakeup.expectedRevision,
        }),
    };
    const targets = onlyKeys ? executions.filter((e) => onlyKeys.includes(e.stageKey)) : executions;
    const invokeSteps = targets.map((execution) => ({
      id: `invoke-stage-${execution.stageKey}`,
      handler: async () => {
        const data: StageExecuteEventData = {
          runId,
          executionEpoch: owner!.executionEpoch,
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
      events: [{ name: 'run/started', data: eventData }],
      steps: invokeSteps,
    });
    return outerEngine.execute();
  }

  async function planFixture() {
    const runs = testApp.app.get(RunService);
    const blueprints = testApp.app.get(BlueprintService);
    const channel = await makeChannel('Planned branches');
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Planned branches');
    const graph = [
      { ...scriptStage(), key: 'script', dependsOn: [] },
      { ...scriptStage(), key: 'scenes', dependsOn: ['script'] },
      { ...scriptStage(), key: 'images', dependsOn: ['scenes'] },
      { ...scriptStage(), key: 'voice', dependsOn: ['script'] },
      { ...scriptStage(), key: 'sync', dependsOn: ['voice', 'scenes'] },
      { ...scriptStage(), key: 'final', dependsOn: ['sync', 'images'] },
    ];
    const dto = { graph, inputs: [], roles: [], defaults: {}, budget: { runCapUsd: 10 } };
    const version = await blueprints.createVersion(blueprintId, dto);
    const created = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 10,
      rerunStageKeys: [],
      untilStageKey: 'images',
    });
    expect(
      (await driveRun(created.id, created.stageExecutions, ['script', 'scenes', 'images'])).error,
    ).toBeUndefined();
    await runs.continueRun(created.id, { blueprintVersionId: version.id, untilStageKey: 'voice' });
    expect((await driveRun(created.id, created.stageExecutions, ['voice'])).error).toBeUndefined();
    return {
      runs,
      blueprints,
      blueprintId,
      dto,
      version,
      created,
      plans: testApp.app.get(RunStagePlanService),
    };
  }

  it('offers a revision-bound join plan using old scene outputs without losing completed images', async () => {
    const f = await planFixture();
    const draft = await f.blueprints.createVersion(
      f.blueprintId,
      {
        ...f.dto,
        graph: f.dto.graph.map((s) =>
          s.key === 'scenes' ? { ...s, instructions: { template: 'New scenes' } } : s,
        ),
      },
      { draft: true },
    );
    const before = await f.runs.get(f.created.id);
    const request = {
      blueprintVersionId: draft.id,
      stageKey: 'sync',
      mode: 'reuse' as const,
      scope: 'stage' as const,
    };
    const plan = await f.plans.preview(f.created.id, request);
    expect(plan.blockedReason).toBeNull();
    expect(plan.runStageKeys).toEqual(['sync']);
    expect(plan.staleStageKeys).toContain('scenes');
    expect(plan.reusedStageKeys).toContain('images');
    const rebuilt = await f.plans.preview(f.created.id, { ...request, mode: 'rebuild' });
    expect(rebuilt.runStageKeys).toEqual(['scenes', 'sync']);
    expect(rebuilt.invalidatedStageKeys).toContain('images');
    const downstream = await f.plans.preview(f.created.id, {
      ...request,
      mode: 'rebuild',
      scope: 'descendants',
    });
    expect(downstream.runStageKeys).toEqual(['scenes', 'images', 'sync', 'final']);
    await f.plans.confirm(f.created.id, { ...request, previewToken: plan.previewToken });
    await expect(
      f.plans.confirm(f.created.id, { ...request, previewToken: plan.previewToken }),
    ).rejects.toBeInstanceOf(ConflictException);
    const ready = await f.runs.get(f.created.id);
    expect(ready.stageExecutions.find((e) => e.stageKey === 'images')).toEqual({
      ...before.stageExecutions.find((e) => e.stageKey === 'images'),
      availableActions: expect.anything(),
    });
    expect((await driveRun(f.created.id, ready.stageExecutions, ['sync'])).error).toBeUndefined();
    expect((await f.runs.get(f.created.id)).state).toBe('IDLE');
    expect(
      (await f.runs.get(f.created.id)).definition?.graph.find((s) => s.key === 'scenes'),
    ).toEqual(f.dto.graph[1]);
    const events = await testDb.db
      .select()
      .from(stageEvent)
      .where(and(eq(stageEvent.runId, f.created.id), eq(stageEvent.type, 'stage.execution_plan')));
    expect(events).toHaveLength(1);
    expect(
      (events[0]!.data as { reusedArtifacts: string[] }).reusedArtifacts.length,
    ).toBeGreaterThan(0);
  });

  it('rebuilds affected descendants in place and rejects changing a confirmed plan scope', async () => {
    const f = await planFixture();
    const draft = await f.blueprints.createVersion(
      f.blueprintId,
      {
        ...f.dto,
        graph: f.dto.graph.map((s) =>
          s.key === 'scenes' ? { ...s, instructions: { template: 'New scenes' } } : s,
        ),
      },
      { draft: true },
    );
    const request = {
      blueprintVersionId: draft.id,
      stageKey: 'sync',
      mode: 'rebuild' as const,
      scope: 'descendants' as const,
    };
    const plan = await f.plans.preview(f.created.id, request);
    await expect(
      f.plans.confirm(f.created.id, {
        ...request,
        scope: 'stage',
        previewToken: plan.previewToken,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    const before = await f.runs.get(f.created.id);
    await f.plans.confirm(f.created.id, { ...request, previewToken: plan.previewToken });
    const ready = await f.runs.get(f.created.id);
    expect(ready.stageExecutions.find((e) => e.stageKey === 'voice')).toEqual({
      ...before.stageExecutions.find((e) => e.stageKey === 'voice'),
      availableActions: expect.anything(),
    });
    expect(
      (await driveRun(f.created.id, ready.stageExecutions, plan.runStageKeys)).error,
    ).toBeUndefined();
    expect((await f.runs.get(f.created.id)).state).toBe('COMPLETED');
    expect(
      (await f.runs.get(f.created.id)).stageExecutions.find((e) => e.stageKey === 'images')
        ?.outputArtifactId,
    ).not.toBe(before.stageExecutions.find((e) => e.stageKey === 'images')?.outputArtifactId);
  });

  it.each([true, false])(
    'checks an existing output without generating another, pass=%s',
    async (pass) => {
      const f = await planFixture();
      const draft = await f.blueprints.createVersion(
        f.blueprintId,
        {
          ...f.dto,
          graph: f.dto.graph.map((s) =>
            s.key === 'scenes'
              ? {
                  ...s,
                  checks: [
                    {
                      type: 'script' as const,
                      name: 'Revalidation',
                      code: `return {pass: ${pass}, detail: "Revalidation"};`,
                    },
                  ],
                }
              : s,
          ),
        },
        { draft: true },
      );
      const request = {
        blueprintVersionId: draft.id,
        stageKey: 'scenes',
        mode: 'validate' as const,
        scope: 'stage' as const,
      };
      const plan = await f.plans.preview(f.created.id, request);
      expect(plan.blockedReason).toBeNull();
      const before = await f.runs.get(f.created.id);
      const oldArtifactId = before.stageExecutions.find(
        (e) => e.stageKey === 'scenes',
      )!.outputArtifactId!;
      const [oldArtifact] = await testDb.db
        .select()
        .from(artifact)
        .where(eq(artifact.id, oldArtifactId));

      await f.plans.confirm(f.created.id, { ...request, previewToken: plan.previewToken });
      const ready = await f.runs.get(f.created.id);
      const submit = vi.spyOn(testApp.app.get(StageRunnerService), 'reserveAndSubmit');
      try {
        expect(
          (await driveRun(f.created.id, ready.stageExecutions, ['scenes'])).error,
        ).toBeUndefined();
        expect(submit).not.toHaveBeenCalled();
        const after = await f.runs.get(f.created.id);
        expect(after.state).toBe(pass ? 'IDLE' : 'FAILED');
        expect(
          (await testDb.db.select().from(artifact).where(eq(artifact.id, oldArtifactId)))[0],
        ).toEqual({ ...oldArtifact, stale: true });
        if (pass) {
          const outputId = after.stageExecutions.find(
            (e) => e.stageKey === 'scenes',
          )!.outputArtifactId!;
          expect(outputId).not.toBe(oldArtifactId);
          const [validated] = await testDb.db
            .select()
            .from(artifact)
            .where(eq(artifact.id, outputId));
          expect(validated?.data).toEqual(oldArtifact!.data);
          expect(validated?.blobId).toEqual(oldArtifact!.blobId);
        }
        if (!pass) {
          const repaired = await f.blueprints.createVersion(
            f.blueprintId,
            {
              ...f.dto,
              graph: f.dto.graph.map((s) =>
                s.key === 'scenes'
                  ? {
                      ...s,
                      checks: [
                        {
                          type: 'script' as const,
                          name: 'Revalidation',
                          code: 'return {pass:true};',
                        },
                      ],
                    }
                  : s,
              ),
            },
            { draft: true },
          );
          const retryRequest = { ...request, blueprintVersionId: repaired.id };
          const retry = await f.plans.preview(f.created.id, retryRequest);
          expect(retry.blockedReason).toBeNull();
          await f.plans.confirm(f.created.id, {
            ...retryRequest,
            previewToken: retry.previewToken,
          });
          expect(
            (await driveRun(f.created.id, ready.stageExecutions, ['scenes'])).error,
          ).toBeUndefined();
          expect((await f.runs.get(f.created.id)).state).toBe('IDLE');
          expect(submit).not.toHaveBeenCalled();
        }
      } finally {
        submit.mockRestore();
      }
    },
  );

  it('rechecks updated QC on the stored output without another generation call', async () => {
    const f = await planFixture();
    const draft = await f.blueprints.createVersion(
      f.blueprintId,
      {
        ...f.dto,
        graph: f.dto.graph.map((s) =>
          s.key === 'scenes'
            ? {
                ...s,
                qc: {
                  criteria: 'Clear scenes',
                  threshold: 0,
                  includeInputs: false,
                  model: {
                    provider: 'fake',
                    modelId: 'fake-text-1',
                    params: { fakeOutput: { score: 90, critique: 'Good', dimensions: [] } },
                  },
                },
              }
            : s,
        ),
      },
      { draft: true },
    );
    const request = {
      blueprintVersionId: draft.id,
      stageKey: 'scenes',
      mode: 'validate' as const,
      scope: 'stage' as const,
    };
    const plan = await f.plans.preview(f.created.id, request);
    expect(plan.validationStageKeys).toContain('scenes');
    expect(plan.blockedReason).toBeNull();
    await f.plans.confirm(f.created.id, { ...request, previewToken: plan.previewToken });
    const ready = await f.runs.get(f.created.id);
    const submit = vi.spyOn(testApp.app.get(StageRunnerService), 'reserveAndSubmit');
    try {
      expect(
        (await driveRun(f.created.id, ready.stageExecutions, ['scenes'])).error,
      ).toBeUndefined();
      expect(submit).not.toHaveBeenCalled();
      expect((await f.runs.get(f.created.id)).state).toBe('IDLE');
    } finally {
      submit.mockRestore();
    }
  });

  it('requires a new run for topology changes and blocks stale-consumer contract changes', async () => {
    const f = await planFixture();
    const draft = await f.blueprints.createVersion(
      f.blueprintId,
      {
        ...f.dto,
        graph: f.dto.graph.map((s) => (s.key === 'sync' ? { ...s, dependsOn: ['voice'] } : s)),
      },
      { draft: true },
    );
    const request = {
      blueprintVersionId: draft.id,
      stageKey: 'sync',
      mode: 'reuse' as const,
      scope: 'stage' as const,
    };
    const reuse = await f.plans.preview(f.created.id, request);
    expect(reuse.blockedReason).toContain('contract changed');
    const rebuild = await f.plans.preview(f.created.id, { ...request, mode: 'rebuild' });
    expect(rebuild.blockedReason).toContain('rewired');
    await expect(
      f.plans.confirm(f.created.id, { ...request, previewToken: reuse.previewToken }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('continues an unfinished branch in the same run, retaining completed sibling artifacts despite draft edits', async () => {
    const runs = testApp.app.get(RunService);
    const blueprints = testApp.app.get(BlueprintService);
    const channel = await makeChannel('Continue branches');
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Continue branches');
    const stage = (key: string, dependsOn: string[]): StageDef => ({
      ...scriptStage(),
      key,
      label: key,
      dependsOn,
    });
    const graph = [
      stage('script', []),
      stage('images', ['script']),
      stage('narration', ['script']),
      stage('audio', ['narration']),
      stage('join', ['images', 'audio']),
    ];
    const version = await blueprints.createVersion(blueprintId, {
      graph,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    const original = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 10,
      rerunStageKeys: [],
      untilStageKey: 'images',
    });
    expect(
      (await driveRun(original.id, original.stageExecutions, ['script', 'images'])).error,
    ).toBeUndefined();
    const before = await runs.get(original.id);
    const artifactsBefore = await testDb.db
      .select()
      .from(artifact)
      .where(eq(artifact.runId, original.id));
    const draft = await blueprints.createVersion(
      blueprintId,
      {
        graph: graph.map((s) =>
          s.key === 'images' ? { ...s, instructions: { template: 'Changed images' } } : s,
        ),
        inputs: [],
        roles: [],
        defaults: {},
        budget: { runCapUsd: 10 },
      },
      { draft: true },
    );
    expect(
      await runs.continueRun(original.id, {
        blueprintVersionId: draft.id,
        untilStageKey: 'narration',
      }),
    ).toEqual({ continued: true });
    await expect(
      runs.continueRun(original.id, {
        blueprintVersionId: draft.id,
        untilStageKey: 'narration',
      }),
    ).rejects.toThrow('already has queued work');
    const [wakeup] = await testDb.db
      .select()
      .from(runWakeup)
      .where(eq(runWakeup.runId, original.id));
    expect(wakeup?.action).toBe('continue');
    expect(
      await testApp.app.get(RunWakeupClaimService).claim({
        wakeupId: wakeup!.id,
        runId: original.id,
        action: 'continue',
        sourceState: wakeup!.sourceState,
        expectedRevision: wakeup!.expectedRevision,
      }),
    ).toEqual({ claimed: true, runId: original.id });
    const continued = await runs.get(original.id);
    expect(continued.blueprintVersionId).toBe(version.id);
    expect(continued.stageExecutions.find((e) => e.stageKey === 'images')).toEqual({
      ...before.stageExecutions.find((e) => e.stageKey === 'images'),
      availableActions: expect.anything(),
    });
    expect(await testDb.db.select().from(artifact).where(eq(artifact.runId, original.id))).toEqual(
      artifactsBefore,
    );
    expect(
      (await driveRun(original.id, continued.stageExecutions, ['narration'])).error,
    ).toBeUndefined();
    expect(
      (await runs.get(original.id)).stageExecutions.find((e) => e.stageKey === 'audio')?.state,
    ).toBe('pending');

    // Run all extends the same run through the join, with no repeated providers on either finished branch.
    expect(await runs.continueRun(original.id, { blueprintVersionId: version.id })).toEqual({
      continued: true,
    });
    expect(
      (await driveRun(original.id, continued.stageExecutions, ['audio', 'join'])).error,
    ).toBeUndefined();
    expect((await runs.get(original.id)).stageExecutions.every((e) => e.state === 'passed')).toBe(
      true,
    );
    expect(await runs.continueRun(original.id, { blueprintVersionId: version.id })).toEqual({
      continued: false,
    });
  });

  it('refuses to silently discard completed sibling work when the requested path also changed', async () => {
    const runs = testApp.app.get(RunService);
    const blueprints = testApp.app.get(BlueprintService);
    const channel = await makeChannel('Protect completed work');
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Protect completed work');
    const graph = ['script', 'images', 'narration'].map((key, i): StageDef => ({
      ...scriptStage(),
      key,
      label: key,
      dependsOn: i === 0 ? [] : ['script'],
    }));
    const dto = { graph, inputs: [], roles: [], defaults: {}, budget: { runCapUsd: 10 } };
    const version = await blueprints.createVersion(blueprintId, dto);
    const base = {
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 10,
      rerunStageKeys: [],
    };
    const original = await runs.create({ ...base, untilStageKey: 'images' });
    expect(
      (await driveRun(original.id, original.stageExecutions, ['script', 'images'])).error,
    ).toBeUndefined();
    const changed = await blueprints.createVersion(blueprintId, {
      ...dto,
      graph: graph.map((s) => ({ ...s, instructions: { template: 'Changed prompt' } })),
    });
    expect(
      await runs.continueRun(original.id, {
        blueprintVersionId: changed.id,
        untilStageKey: 'narration',
      }),
    ).toEqual({ continued: false });
    const before = await runs.get(original.id);
    await expect(
      runs.create({
        ...base,
        blueprintVersionId: changed.id,
        seedFromRunId: original.id,
        rerunStageKeys: ['narration'],
        untilStageKey: 'narration',
        expectReusedBefore: 'narration',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'completed_work_changed',
        plan: {
          discardedStageKeys: ['script', 'images'],
          stop: { stageKey: 'script', reason: 'definition_changed' },
        },
      },
    });
    expect(await runs.get(original.id)).toEqual(before);
  });

  it('applies narration prompt edits in place without dropping images or replaying downstream work', async () => {
    const runs = testApp.app.get(RunService);
    const blueprints = testApp.app.get(BlueprintService);
    const channel = await makeChannel('Edited narration');
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Edited narration');
    const graph = [
      { ...scriptStage(), key: 'script', dependsOn: [] },
      { ...scriptStage(), key: 'images', dependsOn: ['script'] },
      { ...scriptStage(), key: 'narration', dependsOn: ['script'] },
      { ...scriptStage(), key: 'audio', dependsOn: ['narration'] },
      { ...scriptStage(), key: 'join', dependsOn: ['images', 'audio'] },
    ];
    const dto = { graph, inputs: [], roles: [], defaults: {}, budget: { runCapUsd: 10 } };
    const version = await blueprints.createVersion(blueprintId, dto);
    const original = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 10,
      rerunStageKeys: [],
    });
    expect(
      (
        await driveRun(
          original.id,
          original.stageExecutions,
          graph.map((s) => s.key),
        )
      ).error,
    ).toBeUndefined();
    const before = await runs.get(original.id);
    const draft = await blueprints.createVersion(
      blueprintId,
      {
        ...dto,
        graph: graph.map((s) =>
          ['images', 'narration'].includes(s.key)
            ? {
                ...s,
                qc: {
                  criteria: 'Clear narration',
                  threshold: 0,
                  model: {
                    provider: 'fake',
                    modelId: 'fake-text',
                    params: { fakeOutput: { score: 90, critique: 'good', dimensions: [] } },
                  },
                  includeInputs: false,
                },
                instructions: { template: `Edited ${s.key}` },
              }
            : s,
        ),
      },
      { draft: true },
    );
    expect(
      await runs.continueRun(original.id, {
        blueprintVersionId: draft.id,
        untilStageKey: 'narration',
      }),
    ).toEqual({ continued: true });
    const updated = await runs.get(original.id);
    expect(updated.stageExecutions.find((e) => e.stageKey === 'images')).toEqual({
      ...before.stageExecutions.find((e) => e.stageKey === 'images'),
      availableActions: expect.anything(),
    });
    const snapshot = await blueprints.getVersion(updated.blueprintVersionId);
    expect(
      StageDef.array()
        .parse(snapshot.graph)
        .find((s) => s.key === 'images'),
    ).toEqual(graph[1]);
    expect(
      StageDef.array()
        .parse(snapshot.graph)
        .find((s) => s.key === 'narration')?.instructions,
    ).toEqual({
      template: 'Edited narration',
    });
    expect(updated.stageExecutions.find((e) => e.stageKey === 'audio')?.state).toBe('pending');
    expect(updated.stageExecutions.find((e) => e.stageKey === 'join')?.state).toBe('pending');
    const oldNarration = before.stageExecutions.find((e) => e.stageKey === 'narration')!;
    expect(
      (
        await testDb.db
          .select()
          .from(artifact)
          .where(eq(artifact.id, oldNarration.outputArtifactId!))
      )[0]?.stale,
    ).toBe(true);
    expect(
      (await driveRun(original.id, updated.stageExecutions, ['narration'])).error,
    ).toBeUndefined();
    const after = await runs.get(original.id);
    expect(after.state).toBe('IDLE');
    expect(after.stageExecutions.find((e) => e.stageKey === 'narration')?.state).toBe('passed');
    expect(
      await runs.continueRun(original.id, {
        blueprintVersionId: draft.id,
        untilStageKey: 'narration',
      }),
    ).toEqual({ continued: true });
    const repeated = await runs.get(original.id);
    expect(
      (await driveRun(original.id, repeated.stageExecutions, ['narration'])).error,
    ).toBeUndefined();
    expect((await runs.get(original.id)).state).toBe('IDLE');
    expect(after.stageExecutions.find((e) => e.stageKey === 'images')?.outputArtifactId).toBe(
      before.stageExecutions.find((e) => e.stageKey === 'images')?.outputArtifactId,
    );
  });

  it('carries completed visual work through a separate narration branch and blocks an incomplete join', async () => {
    const runs = testApp.app.get(RunService);
    const blueprints = testApp.app.get(BlueprintService);
    const channel = await makeChannel('Seed Branches');
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Seed Branches Blueprint');
    const branch = (key: string, dependsOn: string[]) => ({
      ...scriptStage(),
      key,
      label: key,
      dependsOn,
    });
    const sourceGraph = [
      branch('script', []),
      branch('visual', ['script']),
      branch('narration', ['script']),
      branch('audio', ['narration']),
      branch('timing', ['audio']),
      branch('sheets', ['visual']),
    ];
    const sourceVersion = await blueprints.createVersion(blueprintId, {
      graph: sourceGraph,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    expect(sourceVersion.runnable).toBe(true);
    const base = {
      channelId: channel.id,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 10,
    };
    const visualRun = await runs.create({
      ...base,
      blueprintVersionId: sourceVersion.id,
      rerunStageKeys: [],
      untilStageKey: 'sheets',
    });
    const visualResult = await driveRun(visualRun.id, visualRun.stageExecutions, [
      'script',
      'visual',
      'sheets',
    ]);
    expect(visualResult.error).toBeUndefined();

    const graph = [
      ...sourceGraph.slice(0, 4),
      sourceGraph[5]!,
      branch('timing', ['audio', 'sheets']),
    ];
    const version = await blueprints.createVersion(blueprintId, {
      graph,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    expect(version.runnable).toBe(true);
    const nextBase = { ...base, blueprintVersionId: version.id };

    const narrationRun = await runs.create({
      ...nextBase,
      seedFromRunId: visualRun.id,
      rerunStageKeys: ['narration'],
      untilStageKey: 'narration',
      expectReusedBefore: 'narration',
    });
    expect(
      narrationRun.stageExecutions
        .filter((e) => ['script', 'visual', 'sheets'].includes(e.stageKey))
        .map((e) => e.state),
    ).toEqual(['passed', 'passed', 'passed']);
    expect(
      (await testDb.db.select().from(artifact).where(eq(artifact.runId, narrationRun.id))).filter(
        (a) => ['visual', 'sheets'].includes(a.producerStageKey),
      ),
    ).toHaveLength(2);
    const narrationResult = await driveRun(narrationRun.id, narrationRun.stageExecutions, [
      'narration',
    ]);
    expect(narrationResult.error).toBeUndefined();

    const audioRun = await runs.create({
      ...nextBase,
      seedFromRunId: narrationRun.id,
      rerunStageKeys: ['audio'],
      untilStageKey: 'audio',
      expectReusedBefore: 'audio',
    });
    expect(audioRun.stageExecutions.find((e) => e.stageKey === 'sheets')?.state).toBe('passed');
    expect(
      (await driveRun(audioRun.id, audioRun.stageExecutions, ['audio'])).error,
    ).toBeUndefined();

    const incompleteVisual = await runs.create({
      ...nextBase,
      rerunStageKeys: [],
      untilStageKey: 'audio',
    });
    expect(
      (
        await driveRun(incompleteVisual.id, incompleteVisual.stageExecutions, [
          'script',
          'narration',
          'audio',
        ])
      ).error,
    ).toBeUndefined();
    await expect(
      runs.create({
        ...nextBase,
        seedFromRunId: incompleteVisual.id,
        rerunStageKeys: ['timing'],
        untilStageKey: 'timing',
        expectReusedBefore: 'timing',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'upstream_rerun',
        plan: { stop: { stageKey: 'visual', reason: 'not_run' } },
      },
    });
  });

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
    expect(run2.stageExecutions.find((e) => e.stageKey === 'script')?.state).toBe('pending');

    // No mocks at all — if the orchestrator tried to invoke ANYTHING, this fails.
    const { error, result } = await driveRun(run2.id, run2.stageExecutions, []);
    expect(error).toBeUndefined();
    expect(result).toEqual({ state: 'IDLE' });

    const [run2Row] = await testDb.db.select().from(run).where(eq(run.id, run2.id));
    expect(run2Row?.state).toBe('IDLE');
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
    expect(blobAfterSecond?.gcEligible).toBe(false);
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

  it('refuses to start a stage that needs an unapproved earlier stage re-run, says why when asked to anyway, and reuses it once approved', async () => {
    const runs = testApp.app.get(RunService);
    const blueprints = testApp.app.get(BlueprintService);
    const channel = await makeChannel('Seed Upstream Rerun');
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Seed Upstream Blueprint');
    const v1 = await blueprints.createVersion(blueprintId, {
      graph: [{ ...topicsStage(), approval: { mode: 'stage' } }, scriptStage()],
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

    // Park `topics` behind its approval gate, as a real run does.
    await testDb.db.update(run).set({ state: 'RUNNING' }).where(eq(run.id, run1.id));
    const runner = testApp.app.get(StageRunnerService);
    const { stage, effective, prevStageKey } = await runner.loadStageContext(run1.id, 'topics');
    const attempt = await runner.beginAttempt({
      runId: run1.id,
      stageExecutionId: run1.stageExecutions.find((e) => e.stageKey === 'topics')!.id,
      stageKey: 'topics',
    });
    const submitted = await runner.reserveAndSubmit(stage, attempt, prevStageKey, effective);
    if (submitted.outcome !== 'submitted') throw new Error('expected submission');
    const parked = await runner.fetchAndFinalize(
      stage,
      attempt,
      submitted.handle,
      prevStageKey,
      effective,
    );
    expect(parked.outcome).toBe('approval_required');
    await testDb.db
      .update(run)
      .set({ state: 'PAUSED_APPROVAL', cursorStageKey: 'topics' })
      .where(eq(run.id, run1.id));

    const runSeeded = (expectReusedBefore?: string) =>
      runs.create({
        channelId: channel.id,
        blueprintVersionId: v1.id,
        seedFromRunId: run1.id,
        inputs: {},
        roleBindings: {},
        rerunStageKeys: ['script'],
        untilStageKey: 'script',
        budgetCapUsd: 10,
        ...(expectReusedBefore && { expectReusedBefore }),
      });
    const countRuns = async () =>
      (await testDb.db.select().from(run).where(eq(run.channelId, channel.id))).length;

    // 1. "Run script" while `topics` waits for approval: refused, nothing created.
    const before = await countRuns();
    const refused = await runSeeded('script').catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ConflictException);
    expect((refused as ConflictException).getResponse()).toMatchObject({
      code: 'upstream_rerun',
      plan: { reused: [], stop: { stageKey: 'topics', reason: 'awaiting_approval' } },
    });
    expect(await countRuns()).toBe(before);

    // 2. Insisting re-runs `topics` and records why on it.
    const forced = await runSeeded();
    const topicsExec = forced.stageExecutions.find((e) => e.stageKey === 'topics')!;
    expect(topicsExec.state).toBe('pending');
    const reasons = (
      await testDb.db.select().from(stageEvent).where(eq(stageEvent.runId, forced.id))
    ).filter((e) => e.type === 'stage.rerun_reason');
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatchObject({
      stageExecutionId: topicsExec.id,
      level: 'info',
      message: 'Re-running "topics": it was awaiting approval in the source run',
    });

    // 3. Approve `topics` in the source run, and `script` can build on it.
    await testApp.app.get(HumanActionService).approve(run1.id, 'topics');
    const reused = await runSeeded('script');
    expect(reused.stageExecutions.find((e) => e.stageKey === 'topics')?.state).toBe('passed');
    expect(reused.stageExecutions.find((e) => e.stageKey === 'script')?.state).toBe('pending');
    const events = await testDb.db.select().from(stageEvent).where(eq(stageEvent.runId, reused.id));
    expect(events.filter((e) => e.type === 'stage.reused')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'stage.rerun_reason')).toHaveLength(1);
    expect(events.find((e) => e.type === 'stage.rerun_reason')).toMatchObject({
      message: 'Re-running "script": it was requested to run again',
    });
  });
});
