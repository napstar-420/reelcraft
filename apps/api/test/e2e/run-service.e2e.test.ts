import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { Inngest } from 'inngest';
import type { StageDef } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import { RunController } from '../../src/run/run.controller';
import { INNGEST_CLIENT } from '../../src/orchestration/inngest.client';
import { toUsd } from '../../src/common/money';
import { run, stageEvent, stageExecution } from '../../src/db/schema/index';
import { ulid } from '../../src/common/ulid';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

function textStage(overrides: Partial<StageDef> = {}): StageDef {
  return {
    key: 'outline',
    label: 'Outline',
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    retryLimit: 0,
    ...overrides,
  };
}

/**
 * `max_tokens` is optional model-pin data. When it's absent for a
 * text-modality stage, `RunService.create()` still succeeds —
 * `OpenRouterAdapter.estimate()` reserves `ceilingUsd: 0` for that stage and
 * the real cost is recorded post-hoc via `settleSuccess` once the call
 * completes (§11).
 */
describe('RunService.create budget preconditions (e2e)', () => {
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

  async function createVersion(graph: StageDef[], channelDefaults: Record<string, unknown> = {}) {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);

    const channel = await channels.create('local', {
      name: `Run Service Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: channelDefaults,
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Run Service Blueprint');
    const version = await blueprints.createVersion(blueprintId, {
      graph,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    return { channel, version };
  }

  it('creates a run when a text stage has no effective max_tokens anywhere in the layer stack', async () => {
    const runs = testApp.app.get(RunService);
    const { channel, version } = await createVersion([
      textStage({ model: { provider: 'fake', modelId: 'fake-text-1', params: {} } }),
    ]);

    const created = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });
    expect(created).toBeDefined();

    const [row] = await testDb.db.select().from(run).where(eq(run.id, created.id));
    const resolvedConfig = row?.resolvedConfig as Record<string, { model?: { params?: object } }>;
    expect(resolvedConfig.outline?.model?.params).not.toHaveProperty('max_tokens');
  });

  it('rejects a blueprint version from another channel before creating a run', async () => {
    const runs = testApp.app.get(RunService);
    const channels = testApp.app.get(ChannelService);
    const { version } = await createVersion([
      textStage({
        model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 64 } },
      }),
    ]);
    const other = await channels.create('local', {
      name: `Other Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });

    await expect(
      runs.create({
        channelId: other.id,
        blueprintVersionId: version.id,
        inputs: {},
        roleBindings: {},
        rerunStageKeys: [],
        budgetCapUsd: 10,
      }),
    ).rejects.toThrow('does not belong to the requested channel');
    expect(await testDb.db.select().from(run).where(eq(run.channelId, other.id))).toHaveLength(0);
  });
});

/**
 * §12.4 — `raiseBudget`/`resume`, scoped explicitly to unblocking
 * `PAUSED_BUDGET` (raise-budget is also allowed while `RUNNING`, per the
 * action matrix, but resume only ever applies to `PAUSED_BUDGET`). Tested
 * through `RunController` (not just `RunService`) so the DTO/pipe wiring
 * is proven too, via the same direct-DI-container style
 * `run-orchestrate-inngest.e2e.test.ts` etc. already use for their harness.
 */
describe('RunController raiseBudget & resume (e2e)', () => {
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

  async function createRun(): Promise<string> {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);

    const channel = await channels.create('local', {
      name: `Raise Budget Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Raise Budget Blueprint');
    const version = await blueprints.createVersion(blueprintId, {
      graph: [
        textStage({
          model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 256 } },
        }),
      ],
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
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });
    return created.id;
  }

  it('raiseBudget widens the cap', async () => {
    const controller = testApp.app.get(RunController);
    const runId = await createRun();

    const updated = await controller.raiseBudget(runId, { capUsd: 25 });

    // `budgetCapUsd` is a `numeric` column — round-trips as a string
    // through postgres-js, same as everywhere else in this codebase
    // (`common/money.ts`).
    expect(toUsd(updated.budgetCapUsd)).toBe(25);
  });

  it('raiseBudget rejects a completed run', async () => {
    const controller = testApp.app.get(RunController);
    const runId = await createRun();
    await testDb.db.update(run).set({ state: 'COMPLETED' }).where(eq(run.id, runId));

    await expect(controller.raiseBudget(runId, { capUsd: 25 })).rejects.toThrow();
  });

  it.each(['CREATED', 'RUNNING', 'COMPLETED'] as const)(
    'resume rejects a %s run, naming the actual state',
    async (state) => {
      const controller = testApp.app.get(RunController);
      const runId = await createRun();
      if (state !== 'CREATED') {
        await testDb.db.update(run).set({ state }).where(eq(run.id, runId));
      }

      await expect(controller.resume(runId)).rejects.toThrow(new RegExp(state));
    },
  );

  it('resume leaves a PAUSED_BUDGET run parked and sends a revision-bound run/resumed', async () => {
    const controller = testApp.app.get(RunController);
    const runId = await createRun();
    await testDb.db
      .update(run)
      .set({ state: 'PAUSED_BUDGET', cursorStageKey: 'outline' })
      .where(eq(run.id, runId));
    const inngestClient = testApp.app.get<Inngest>(INNGEST_CLIENT);
    vi.mocked(inngestClient.send).mockClear();

    const updated = await controller.resume(runId);

    expect(updated.state).toBe('PAUSED_BUDGET');
    expect(inngestClient.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'run/resumed',
        data: expect.objectContaining({ runId, action: 'resume', sourceState: 'PAUSED_BUDGET' }),
      }),
    );
  });

  it('raiseBudget resumes a run paused for budget in the same request', async () => {
    const controller = testApp.app.get(RunController);
    const runId = await createRun();
    await testDb.db
      .update(run)
      .set({ state: 'PAUSED_BUDGET', cursorStageKey: 'outline' })
      .where(eq(run.id, runId));
    const inngestClient = testApp.app.get<Inngest>(INNGEST_CLIENT);
    vi.mocked(inngestClient.send).mockClear();

    const updated = await controller.raiseBudget(runId, { capUsd: 25 });

    expect(toUsd(updated.budgetCapUsd)).toBe(25);
    expect(inngestClient.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'run/resumed',
        data: expect.objectContaining({ runId, sourceState: 'PAUSED_BUDGET' }),
      }),
    );
  });

  it('raiseBudget only widens the cap of a run that is not paused for budget', async () => {
    const controller = testApp.app.get(RunController);
    const runId = await createRun();
    await testDb.db.update(run).set({ state: 'RUNNING' }).where(eq(run.id, runId));
    const inngestClient = testApp.app.get<Inngest>(INNGEST_CLIENT);
    vi.mocked(inngestClient.send).mockClear();

    const updated = await controller.raiseBudget(runId, { capUsd: 25 });

    expect(updated.state).toBe('RUNNING');
    expect(inngestClient.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'run/resumed' }),
    );
  });

  it('raiseBudget explains a cap that is not higher', async () => {
    const controller = testApp.app.get(RunController);
    const runId = await createRun();
    await expect(controller.raiseBudget(runId, { capUsd: 5 })).rejects.toThrow(
      /must be higher than the current cap/,
    );
  });

  it('reports a stage-cap block and raises that stage cap as a run override', async () => {
    const controller = testApp.app.get(RunController);
    const runs = testApp.app.get(RunService);
    const runId = await createRun();
    await testDb.db
      .update(run)
      .set({
        state: 'PAUSED_BUDGET',
        cursorStageKey: 'outline',
        overrides: { outline: { budget: { stageCapUsd: 0.5 } } },
      })
      .where(eq(run.id, runId));
    const [execution] = await testDb.db
      .select()
      .from(stageExecution)
      .where(and(eq(stageExecution.runId, runId), eq(stageExecution.stageKey, 'outline')));
    await testDb.db.insert(stageEvent).values({
      id: ulid(),
      runId,
      stageExecutionId: execution!.id,
      level: 'warn',
      type: 'attempt.finished',
      message: 'Budget blocked (stage cap)',
      data: { outcome: 'budget_blocked', reason: 'stage_cap_exceeded' },
      createdAt: new Date().toISOString(),
    });

    const paused = await runs.get(runId);
    expect(paused.budgetBlock).toEqual({ scope: 'stage', stageKey: 'outline', stageCapUsd: 0.5 });

    await expect(
      controller.raiseBudget(runId, { capUsd: 0.25, stageKey: 'outline' }),
    ).rejects.toThrow(/must be higher than the current stage cap/);

    const inngestClient = testApp.app.get<Inngest>(INNGEST_CLIENT);
    vi.mocked(inngestClient.send).mockClear();
    const raised = await controller.raiseBudget(runId, { capUsd: 2, stageKey: 'outline' });

    expect(raised.overrides).toEqual({ outline: { budget: { stageCapUsd: 2 } } });
    expect(toUsd(raised.budgetCapUsd)).toBe(10);
    expect(inngestClient.send).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'run/resumed' }),
    );
  });

  it('reports a run-cap block by default', async () => {
    const runs = testApp.app.get(RunService);
    const runId = await createRun();
    await testDb.db
      .update(run)
      .set({ state: 'PAUSED_BUDGET', cursorStageKey: 'outline' })
      .where(eq(run.id, runId));

    expect((await runs.get(runId)).budgetBlock).toEqual({
      scope: 'run',
      stageKey: 'outline',
      stageCapUsd: null,
    });
  });

  it('accepts FAILED as an explicit generic recovery point', async () => {
    const controller = testApp.app.get(RunController);
    const runId = await createRun();
    await testDb.db
      .update(run)
      .set({ state: 'FAILED', cursorStageKey: 'outline' })
      .where(eq(run.id, runId));
    await testDb.db
      .update(stageExecution)
      .set({ state: 'failed' })
      .where(and(eq(stageExecution.runId, runId), eq(stageExecution.stageKey, 'outline')));

    await expect(controller.resume(runId)).resolves.toMatchObject({ state: 'FAILED' });
  });
});
