import { RunStateService } from '../../src/orchestration/run-state.service';
import { CapabilityRegistry } from '../../src/capability/capability.registry';
import { RunWakeupClaimService } from '../../src/run/run-wakeup-claim.service';
import { HumanActionService } from '../../src/run/human-action.service';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { InngestTestEngine } from '@inngest/test';
import { and, eq, desc } from 'drizzle-orm';
import { StageDef } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import { RunStagePlanService } from '../../src/run/run-stage-plan.service';
import { RunCancellationService } from '../../src/run/run-cancellation.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import {
  run,
  runWakeup,
  stageItem,
  stageExecution,
  stageAttempt,
  artifact,
} from '../../src/db/schema';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

const stage = (key: string, dependsOn: string[] = []): StageDef =>
  StageDef.parse({
    key,
    label: key,
    dependsOn,
    capability: 'text.generate',
    config: {},
    checks: [],
    retryLimit: 0,
    slots: {},
    context: {},
    output: { kind: 'text' },
    model: { provider: 'fake', modelId: 'fake-text-1', params: { fakeOutput: { text: 'saved' } } },
  });

describe('unified resumable execution', () => {
  let database: TestDb,
    app: TestApp,
    runs: RunService,
    plans: RunStagePlanService,
    runner: StageRunnerService;
  beforeAll(async () => {
    database = await createTestDb();
    app = await buildTestApp(database);
    runs = app.app.get(RunService);
    plans = app.app.get(RunStagePlanService);
    runner = app.app.get(StageRunnerService);
  });
  afterAll(async () => {
    await app?.close();
    await database?.teardown();
  });
  async function fixture(graph: StageDef[]) {
    const channel = await app.app
      .get(ChannelService)
      .create('local', { name: `DAG ${Math.random()}`, theme: {}, defaults: {} });
    const blueprints = app.app.get(BlueprintService);
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'DAG');
    const version = await blueprints.createVersion(blueprintId, {
      graph,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 100 },
    });
    expect(version.runnable).toBe(true);
    const created = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 100,
      rerunStageKeys: [],
    });
    return { created, version };
  }
  async function item(runId: string, executionId: string, index: number, epoch = 0) {
    const saved = await runner.itemState(executionId, index);
    const fn = app.functions.find((f) => f.id() === 'stage.execute.item')!;
    const result = await new InngestTestEngine({
      function: fn,
      events: [
        {
          name: 'stage/execute.item.requested',
          data: {
            runId,
            stageExecutionId: executionId,
            stageKey: 'motion',
            itemIndex: index,
            stageItemId: saved.id,
            executionEpoch: epoch,
            executionKey: `${runId}:${epoch}`,
          },
        },
      ],
    }).execute();
    expect(result.error).toBeUndefined();
    return result.result;
  }
  async function drive(runId: string, expectedKeys: string[]) {
    const detail = await runs.get(runId);
    const [wakeup] = await database.db
      .select()
      .from(runWakeup)
      .where(and(eq(runWakeup.runId, runId), eq(runWakeup.expectedRevision, detail.revision!)))
      .orderBy(desc(runWakeup.createdAt))
      .limit(1);
    const submitted: number[] = [];
    const fn = app.functions.find((f) => f.id() === 'run.orchestrate')!;
    const result = await new InngestTestEngine({
      function: fn,
      events: [
        {
          name: wakeup?.eventName ?? 'run/started',
          data: {
            runId,
            executionEpoch: detail.executionEpoch,
            executionKey: `${runId}:${detail.executionEpoch}`,
            ...(wakeup && {
              wakeupId: wakeup.id,
              action: wakeup.action,
              sourceState: wakeup.sourceState,
              expectedRevision: wakeup.expectedRevision,
            }),
          },
        },
      ],
      steps: expectedKeys.map((key) => ({
        id: `invoke-stage-${key}`,
        handler: async () => {
          const execution = detail.stageExecutions.find((e) => e.stageKey === key)!;
          const result = await new InngestTestEngine({
            function: app.functions.find((f) => f.id() === 'stage.execute')!,
            events: [
              {
                name: 'stage/execute.requested',
                data: {
                  runId,
                  stageExecutionId: execution.id,
                  stageKey: key,
                  executionEpoch: detail.executionEpoch,
                  executionKey: `${runId}:${detail.executionEpoch}`,
                },
              },
            ],
            steps:
              key === 'motion'
                ? Array.from({ length: 14 }, (_, index) => ({
                    id: `run-item-${index}`,
                    handler: async () => {
                      submitted.push(index);
                      return item(runId, execution.id, index, detail.executionEpoch);
                    },
                  }))
                : [],
          }).execute();
          if (result.error) throw result.error;
          return result.result;
        },
      })),
    }).execute();
    expect(result.error).toBeUndefined();
    return { result: result.result, submitted };
  }
  async function execute(
    runId: string,
    stageKey?: string,
    action: 'run' | 'continue' | 'rerun' = 'run',
    itemIndex?: number,
  ) {
    const current = await runs.get(runId);
    const request = {
      blueprintVersionId: current.blueprintVersionId,
      action,
      mode: 'reuse' as const,
      scope: 'stage' as const,
      ...(stageKey && { stageKey }),
      ...(itemIndex !== undefined && { itemIndex }),
    };
    const plan = await plans.preview(runId, request);
    expect(plan.blockedReason).toBeNull();
    await plans.confirm(runId, { ...request, previewToken: plan.previewToken });
    return plan;
  }
  it.each([
    { name: 'consecutive', passed: [0, 1, 2, 3, 4, 5] },
    { name: 'non-contiguous', passed: [0, 2, 4, 7, 9, 13] },
  ])('continues exactly eight unfinished items with $name progress', async ({ name, passed }) => {
    const values = Array.from({ length: 14 }, (_, i) => `shot ${i}`);
    const motion = StageDef.parse({
      ...stage('motion'),
      dependsOn: ['source'],
      iterate: {
        over: { from: 'stage', stageKey: 'source' },
        itemAlias: 'shot',
        itemRetryLimit: 0,
        maxItems: 20,
        concurrency: 3,
      },
      slots: { shot: { from: 'item' } },
    });
    const source = StageDef.parse({
      ...stage('source'),
      output: { kind: 'data', schema: { type: 'array', items: { type: 'string' } } },
      model: { provider: 'fake', modelId: 'fake-text-1', params: { fakeOutput: values } },
    });
    const { created } = await fixture([source, motion, stage('final', ['motion'])]);
    expect(created.stageExecutions.every((e) => e.state === 'pending')).toBe(true);
    await database.db.update(run).set({ state: 'RUNNING' }).where(eq(run.id, created.id));
    const sourceResult = await new InngestTestEngine({
      function: app.functions.find((f) => f.id() === 'stage.execute')!,
      events: [
        {
          name: 'stage/execute.requested',
          data: {
            runId: created.id,
            stageExecutionId: created.stageExecutions.find((e) => e.stageKey === 'source')!.id,
            stageKey: 'source',
            executionEpoch: 0,
          },
        },
      ],
    }).execute();
    expect(sourceResult.error).toBeUndefined();
    const execution = created.stageExecutions.find((e) => e.stageKey === 'motion')!;
    const ctx = await runner.loadStageContext(created.id, 'motion');
    const resolved = await runner.resolveIterateCount(
      created.id,
      execution.id,
      ctx.stage,
      ctx.effective,
      ctx.prevStageKey,
    );
    if (!resolved.ok) throw new Error(resolved.reason);
    await runner.ensureStageItems(execution.id, 14, resolved.fingerprints);
    for (const index of passed) await item(created.id, execution.id, index);
    const before = await database.db
      .select()
      .from(stageItem)
      .where(and(eq(stageItem.stageExecutionId, execution.id), eq(stageItem.state, 'passed')));
    if (name === 'consecutive') {
      await database.db
        .update(stageItem)
        .set({ inputFingerprint: resolved.fingerprints[1] })
        .where(eq(stageItem.id, before[0]!.id));
      expect(
        await runner.resolveIterateCount(
          created.id,
          execution.id,
          ctx.stage,
          ctx.effective,
          ctx.prevStageKey,
        ),
      ).toEqual({ ok: false, reason: 'iteration_identity_changed_rebuild_required' });
      await database.db
        .update(stageItem)
        .set({ inputFingerprint: null })
        .where(eq(stageItem.stageExecutionId, execution.id));
      expect(
        (
          await runner.resolveIterateCount(
            created.id,
            execution.id,
            ctx.stage,
            ctx.effective,
            ctx.prevStageKey,
          )
        ).ok,
      ).toBe(true);
    }
    await database.db
      .update(run)
      .set({ executionScope: { kind: 'selection', stageKeys: ['motion'] } })
      .where(eq(run.id, created.id));
    if (name === 'non-contiguous') {
      for (const index of [1, 3]) {
        const saved = await runner.itemState(execution.id, index);
        await runner.beginAttempt({
          runId: created.id,
          stageExecutionId: execution.id,
          stageKey: 'motion',
          stageItemId: saved.id,
          itemIndex: index,
          executionEpoch: 0,
        });
      }
    }
    await app.app.get(RunCancellationService).cancel(created.id);
    if (name === 'consecutive') {
      // Exact pre-generation cancellation shape: terminal outcomes, live phases/items, epoch zero.
      await database.db.update(run).set({ executionEpoch: 0 }).where(eq(run.id, created.id));
      for (const index of [6, 7]) {
        const saved = await runner.itemState(execution.id, index);
        await database.db
          .update(stageItem)
          .set({ state: 'running' })
          .where(eq(stageItem.id, saved.id));
        await database.db.insert(stageAttempt).values({
          id: `legacy-cancel-${saved.id}`,
          stageExecutionId: execution.id,
          stageItemId: saved.id,
          attemptNo: 1,
          outcome: 'cancelled',
          phase: 'created',
          durationMs: 481,
          actor: 'engine',
          resolvedInputs: {},
        });
      }
    }
    const cancelled = await runs.get(created.id);
    expect(cancelled.state).toBe('CANCELLED');
    expect(cancelled.availableActions).toMatchObject({ busy: false, resume: true });
    expect(
      cancelled.stageExecutions.find((e) => e.stageKey === 'motion')!.availableActions,
    ).toMatchObject({ continue: true, completedItems: 6, totalItems: 14 });
    const plan = await execute(
      created.id,
      name === 'consecutive' ? 'motion' : undefined,
      'continue',
    );
    expect(plan.runStageKeys).toEqual(['motion']);
    expect(plan.retainedItemCount).toBe(6);
    const recoveredItems = await database.db
      .select()
      .from(stageItem)
      .where(eq(stageItem.stageExecutionId, execution.id));
    expect(recoveredItems.filter((i) => i.state === 'running')).toHaveLength(0);
    const recoveredAttempts = await database.db
      .select()
      .from(stageAttempt)
      .where(
        and(eq(stageAttempt.stageExecutionId, execution.id), eq(stageAttempt.outcome, 'cancelled')),
      );
    expect(recoveredAttempts.every((a) => a.phase === 'settled')).toBe(true);
    const continued = await drive(created.id, ['motion']);
    expect(continued.submitted.sort((a, b) => a - b)).toEqual(
      values.map((_, i) => i).filter((i) => !passed.includes(i)),
    );
    const after = await database.db
      .select()
      .from(stageItem)
      .where(eq(stageItem.stageExecutionId, execution.id));
    for (const saved of before)
      expect(after.find((i) => i.id === saved.id)?.outputArtifactId).toBe(saved.outputArtifactId);
    expect((await runs.get(created.id)).state).toBe('IDLE');
    await execute(created.id);
    await drive(created.id, ['final']);
    expect((await runs.get(created.id)).state).toBe('COMPLETED');
  });
  it('cancellation settles all admission phases, including previously confirmed attempts', async () => {
    const phases = ['created', 'reserved', 'submitting', 'submitted', 'created'] as const;
    const { created } = await fixture(phases.map((_, index) => stage(`a${index}`)));
    await database.db.update(run).set({ state: 'RUNNING' }).where(eq(run.id, created.id));
    for (const [index, phase] of phases.entries()) {
      const execution = created.stageExecutions.find((e) => e.stageKey === `a${index}`)!;
      const attempt = await runner.beginAttempt({
        runId: created.id,
        stageExecutionId: execution.id,
        stageKey: execution.stageKey,
        executionEpoch: 0,
      });
      await database.db
        .update(stageAttempt)
        .set({ phase, cancellationConfirmed: index === 4 ? true : null })
        .where(eq(stageAttempt.id, attempt.stageAttemptId));
    }
    expect((await runs.get(created.id)).availableActions?.busy).toBe(true);
    await app.app.get(RunCancellationService).cancel(created.id);
    const detail = await runs.get(created.id);
    expect(detail.availableActions).toMatchObject({ busy: false, resume: true });
    for (const execution of created.stageExecutions) {
      const [attempt] = await database.db
        .select()
        .from(stageAttempt)
        .where(eq(stageAttempt.stageExecutionId, execution.id));
      expect(attempt).toMatchObject({ phase: 'settled', outcome: 'cancelled' });
      expect(attempt!.cancellationConfirmed).toBe(!['a2', 'a3'].includes(execution.stageKey));
    }
    const plan = await plans.preview(created.id, {
      blueprintVersionId: created.blueprintVersionId,
      action: 'continue',
      mode: 'reuse',
      scope: 'stage',
    });
    expect(plan.uncertainAttemptIds).toHaveLength(2);
    await expect(
      plans.confirm(created.id, { ...plan.request, previewToken: plan.previewToken }),
    ).rejects.toThrow();
  });
  it('rejects blocked stage-only work without admitting prerequisites; reruns stale descendants only when explicitly selected', async () => {
    const { created } = await fixture([stage('a'), stage('b', ['a']), stage('c', ['b'])]);
    await database.db.update(run).set({ state: 'IDLE' }).where(eq(run.id, created.id));
    const blocked = await plans.preview(created.id, {
      blueprintVersionId: created.blueprintVersionId,
      stageKey: 'b',
      action: 'run',
      mode: 'reuse',
      scope: 'stage',
    });
    expect(blocked.blockedReason).toContain('a');
    expect(blocked.runStageKeys).toEqual(['b']);
    await expect(
      plans.confirm(created.id, { ...blocked.request, previewToken: blocked.previewToken }),
    ).rejects.toThrow();
    expect(
      await database.db
        .select()
        .from(stageAttempt)
        .innerJoin(stageExecution, eq(stageAttempt.stageExecutionId, stageExecution.id))
        .where(eq(stageExecution.runId, created.id)),
    ).toHaveLength(0);
    await execute(created.id);
    await drive(created.id, ['a', 'b', 'c']);
    const before = await runs.get(created.id);
    const b = before.stageExecutions.find((e) => e.stageKey === 'b')!;
    const plan = await execute(created.id, 'a', 'rerun');
    expect(plan.invalidatedStageKeys).toEqual(expect.arrayContaining(['b', 'c']));
    await drive(created.id, ['a']);
    const after = await runs.get(created.id);
    expect(after.state).toBe('IDLE');
    expect(after.stageExecutions.find((e) => e.stageKey === 'b')?.state).toBe('stale');
    const [old] = await database.db
      .select()
      .from(artifact)
      .where(eq(artifact.id, b.outputArtifactId!));
    expect(old?.stale).toBe(true);
    await expect(
      plans.confirm(created.id, { ...plan.request, previewToken: plan.previewToken }),
    ).rejects.toThrow();
  });
  it('keeps a production run on its saved version through stage actions; draftsOnly lists only test runs', async () => {
    const { created, version } = await fixture([stage('a'), stage('b', ['a'])]);
    await execute(created.id);
    await drive(created.id, ['a', 'b']);
    await execute(created.id, 'b', 'rerun');
    const after = await runs.get(created.id);
    expect(after.blueprintVersionId).toBe(version.id);
    const blueprintId = version.blueprintId;
    const draftVersion = await app.app.get(BlueprintService).createVersion(
      blueprintId,
      {
        graph: [stage('a'), stage('b', ['a'])],
        inputs: [],
        roles: [],
        defaults: {},
        budget: { runCapUsd: 100 },
      },
      { draft: true },
    );
    const test = await runs.create({
      channelId: after.channelId,
      blueprintVersionId: draftVersion.id,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 100,
      rerunStageKeys: [],
    });
    const list = (draftsOnly: boolean) =>
      runs.list({
        blueprintId,
        includeDryRuns: false,
        includeDrafts: false,
        draftsOnly,
        limit: 20,
        offset: 0,
      });
    expect((await list(true)).items.map((r) => r.id)).toEqual([test.id]);
    expect((await list(false)).items.map((r) => r.id)).toEqual([created.id]);
  });
  it('fences retired attempt admission and publication and binds concurrency changes to plan revisions', async () => {
    const { created } = await fixture([stage('a')]);
    await database.db.update(run).set({ state: 'RUNNING' }).where(eq(run.id, created.id));
    const ctx = await runner.loadStageContext(created.id, 'a');
    const attempt = await runner.beginAttempt({
      runId: created.id,
      stageExecutionId: created.stageExecutions[0]!.id,
      stageKey: 'a',
      executionEpoch: 0,
    });
    const submitted = await runner.reserveAndSubmit(
      ctx.stage,
      attempt,
      ctx.prevStageKey,
      ctx.effective,
    );
    if (submitted.outcome !== 'submitted') throw new Error('not submitted');
    await app.app.get(RunCancellationService).cancel(created.id);
    const previous = await runs.get(created.id);
    const plan = await plans.preview(created.id, {
      blueprintVersionId: created.blueprintVersionId,
      stageKey: 'a',
      action: 'continue',
      mode: 'reuse',
      scope: 'stage',
      allowUncertainRestart: true,
    });
    await runs.updateExecutionSettings(created.id, 1);
    await expect(
      plans.confirm(created.id, { ...plan.request, previewToken: plan.previewToken }),
    ).rejects.toThrow();
    await database.db.update(run).set({ state: 'RUNNING' }).where(eq(run.id, created.id));
    await expect(
      runner.beginAttempt({
        runId: created.id,
        stageExecutionId: created.stageExecutions[0]!.id,
        stageKey: 'a',
        executionEpoch: 0,
      }),
    ).rejects.toThrow('retired');
    const late = await runner.fetchAndFinalize(
      ctx.stage,
      attempt,
      submitted.handle,
      ctx.prevStageKey,
      ctx.effective,
    );
    expect(late.outcome).toBe('run_not_running');
    expect((await runs.get(created.id)).stageExecutions[0]!.outputArtifactId).toBeNull();
    expect(previous.executionEpoch).toBe(1);
  });
  it('preserves a concurrent pause and rejects retired coordinator transitions', async () => {
    const { created } = await fixture([stage('a')]);
    await database.db
      .update(run)
      .set({ state: 'PAUSING', executionEpoch: 2 })
      .where(eq(run.id, created.id));
    const states = app.app.get(RunStateService);
    await states.transition(created.id, 'COMPLETED', 1);
    expect((await runs.get(created.id)).state).toBe('PAUSING');
    await states.transition(created.id, 'COMPLETED', 2);
    expect((await runs.get(created.id)).state).toBe('PAUSED_MANUAL');
  });
  it('preserves a saved approval candidate across cancellation and continuation', async () => {
    const { created } = await fixture([
      { ...stage('a'), approval: { mode: 'stage' } },
      stage('b', ['a']),
    ]);
    await runs.start(created.id);
    await drive(created.id, ['a']);
    const before = await database.db
      .select()
      .from(stageAttempt)
      .where(eq(stageAttempt.stageExecutionId, created.stageExecutions[0]!.id));
    expect(before).toHaveLength(1);
    expect(before[0]!.artifactId).toBeTruthy();
    await app.app.get(RunCancellationService).cancel(created.id);
    await execute(created.id, undefined, 'continue');
    await drive(created.id, []);
    expect((await runs.get(created.id)).state).toBe('PAUSED_APPROVAL');
    const restored = await database.db
      .select()
      .from(stageAttempt)
      .where(eq(stageAttempt.stageExecutionId, created.stageExecutions[0]!.id));
    expect(restored.map((a) => a.artifactId)).toEqual(before.map((a) => a.artifactId));
    await app.app.get(HumanActionService).approve(created.id, 'a');
    await drive(created.id, ['b']);
    expect((await runs.get(created.id)).state).toBe('COMPLETED');
  });
  it('requires confirmation for uncertain cancellation, accepts one concurrent confirmation, and ignores a delayed cancellation', async () => {
    const { created } = await fixture([stage('a')]);
    await database.db.update(run).set({ state: 'RUNNING' }).where(eq(run.id, created.id));
    const context = await runner.loadStageContext(created.id, 'a');
    const attempt = await runner.beginAttempt({
      runId: created.id,
      stageExecutionId: created.stageExecutions[0]!.id,
      stageKey: 'a',
    });
    const submitted = await runner.reserveAndSubmit(
      context.stage,
      attempt,
      context.prevStageKey,
      context.effective,
    );
    expect(submitted.outcome).toBe('submitted');
    const capability = app.app.get(CapabilityRegistry).get('text.generate');
    const cancellation = vi
      .spyOn(capability as { cancel: NonNullable<typeof capability.cancel> }, 'cancel')
      .mockResolvedValue({ confirmed: false, reason: 'Provider did not confirm cancellation' });
    try {
      await app.app.get(RunCancellationService).cancel(created.id);
    } finally {
      cancellation.mockRestore();
    }
    const request = {
      blueprintVersionId: created.blueprintVersionId,
      stageKey: 'a',
      action: 'continue' as const,
      mode: 'reuse' as const,
      scope: 'stage' as const,
    };
    await database.db
      .update(stageAttempt)
      .set({ cancellationConfirmed: null })
      .where(eq(stageAttempt.id, attempt.stageAttemptId));
    const blocked = await plans.preview(created.id, request);
    expect(blocked.uncertainAttemptIds).toEqual([attempt.stageAttemptId]);
    expect(blocked.blockedReason).toContain('additional charges');
    await database.db
      .update(stageAttempt)
      .set({ phase: 'submitting', jobHandle: null })
      .where(eq(stageAttempt.id, attempt.stageAttemptId));
    expect((await runs.get(created.id)).availableActions?.busy).toBe(false);
    expect((await plans.preview(created.id, request)).uncertainAttemptIds).toEqual([
      attempt.stageAttemptId,
    ]);
    const allowed = await plans.preview(created.id, { ...request, allowUncertainRestart: true });
    expect(allowed.blockedReason).toBeNull();
    const results = await Promise.allSettled([
      plans.confirm(created.id, { ...allowed.request, previewToken: allowed.previewToken }),
      plans.confirm(created.id, { ...allowed.request, previewToken: allowed.previewToken }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const current = await runs.get(created.id);
    const [wakeup] = await database.db
      .select()
      .from(runWakeup)
      .where(
        and(eq(runWakeup.runId, created.id), eq(runWakeup.expectedRevision, current.revision!)),
      );
    const claimed = await app.app.get(RunWakeupClaimService).claim({
      runId: created.id,
      wakeupId: wakeup!.id,
      action: 'continue',
      sourceState: wakeup!.sourceState,
      expectedRevision: wakeup!.expectedRevision,
      executionEpoch: wakeup!.executionEpoch,
    });
    expect(claimed.claimed).toBe(true);
    await app.app.get(RunCancellationService).reconcileCancellation(created.id, 0);
    expect((await runs.get(created.id)).state).toBe('RUNNING');
    await expect(runner.beginAttempt({ ...attempt, executionEpoch: 0 })).rejects.toThrow('retired');
  });
  it('admits only one of two concurrent resume requests', async () => {
    const { created } = await fixture([stage('a')]);
    await database.db.update(run).set({ state: 'PAUSED_MANUAL' }).where(eq(run.id, created.id));
    const results = await Promise.allSettled([runs.resume(created.id), runs.resume(created.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const wakeups = await database.db
      .select()
      .from(runWakeup)
      .where(eq(runWakeup.runId, created.id));
    expect(wakeups).toHaveLength(1);
    expect(wakeups[0]!.executionEpoch).toBe(1);
  });

  it('completes an empty iteration without submitting an item', async () => {
    const source = StageDef.parse({
      ...stage('source'),
      output: { kind: 'data', schema: { type: 'array', items: { type: 'string' } } },
      model: { provider: 'fake', modelId: 'fake-text-1', params: { fakeOutput: [] } },
    });
    const motion = StageDef.parse({
      ...stage('motion', ['source']),
      iterate: {
        over: { from: 'stage', stageKey: 'source' },
        itemAlias: 'shot',
        itemRetryLimit: 0,
      },
    });
    const { created } = await fixture([source, motion]);
    await runs.start(created.id);
    const completed = await drive(created.id, ['source', 'motion']);
    expect(completed.submitted).toEqual([]);
    const detail = await runs.get(created.id);
    expect(detail.state).toBe('COMPLETED');
    expect(detail.stageExecutions.find((e) => e.stageKey === 'motion')).toMatchObject({
      state: 'passed',
      itemCount: 0,
    });
  });

  it('fences a cancellation reconciler that resumes after a new generation has started', async () => {
    const { created } = await fixture([stage('a')]);
    await database.db
      .update(run)
      .set({ state: 'CANCELLING', executionEpoch: 1 })
      .where(eq(run.id, created.id));
    await database.db
      .update(stageExecution)
      .set({ state: 'running' })
      .where(eq(stageExecution.id, created.stageExecutions[0]!.id));
    const cancellation = app.app.get(RunCancellationService);
    const internal = cancellation as unknown as {
      settleOutstanding: (id: string, epoch: number) => Promise<void>;
    };
    const settle = internal.settleOutstanding.bind(cancellation);
    let release = () => {};
    let entered = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const intercepted = vi
      .spyOn(internal, 'settleOutstanding')
      .mockImplementationOnce(async (id, epoch) => {
        entered();
        await waiting;
        await settle(id, epoch);
      });
    try {
      const delayed = cancellation.reconcileCancellation(created.id, 0);
      await started;
      await cancellation.reconcileCancellation(created.id, 0);
      await execute(created.id, 'a', 'continue');
      const current = await runs.get(created.id);
      const [wakeup] = await database.db
        .select()
        .from(runWakeup)
        .where(
          and(eq(runWakeup.runId, created.id), eq(runWakeup.expectedRevision, current.revision!)),
        );
      await app.app.get(RunWakeupClaimService).claim({
        runId: created.id,
        wakeupId: wakeup!.id,
        action: 'continue',
        sourceState: wakeup!.sourceState,
        expectedRevision: wakeup!.expectedRevision,
        executionEpoch: wakeup!.executionEpoch,
      });
      const attempt = await runner.beginAttempt({
        runId: created.id,
        stageExecutionId: created.stageExecutions[0]!.id,
        stageKey: 'a',
        executionEpoch: 2,
      });
      release();
      await delayed;
      const after = await runs.get(created.id);
      expect(after.state).toBe('RUNNING');
      expect(after.stageExecutions[0]!.state).toBe('running');
      const [saved] = await database.db
        .select()
        .from(stageAttempt)
        .where(eq(stageAttempt.id, attempt.stageAttemptId));
      expect(saved?.phase).toBe('created');
    } finally {
      release();
      intercepted.mockRestore();
    }
  });
});
