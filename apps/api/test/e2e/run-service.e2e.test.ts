import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { Inngest } from 'inngest';
import type { StageDef } from '@reefcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import { RunController } from '../../src/run/run.controller';
import { INNGEST_CLIENT } from '../../src/orchestration/inngest.client';
import { toUsd } from '../../src/common/money';
import { run, stageExecution } from '../../src/db/schema/index';
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
 * §16.5 — `blueprint-validator.service.ts` can only WARN about a missing
 * `max_tokens` at save time (it can't see the channel layer, where
 * `max_tokens` usually lives). `RunService.create()` is where the full
 * layer stack has actually resolved, so an unbounded text reservation
 * becomes a hard error there instead — `estimateCost`/`reserve` (§11)
 * can't produce an honest ceiling without it.
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

  it('throws, naming the stage, when a text stage has no effective max_tokens anywhere in the layer stack', async () => {
    const runs = testApp.app.get(RunService);
    const { channel, version } = await createVersion([
      textStage({ model: { provider: 'fake', modelId: 'fake-text-1', params: {} } }),
    ]);

    await expect(
      runs.create({
        channelId: channel.id,
        blueprintVersionId: version.id,
        inputs: {},
        roleBindings: {},
        budgetCapUsd: 10,
      }),
    ).rejects.toThrow(/"outline".*max_tokens/);
  });

  it('succeeds when max_tokens is set on the channel layer, not just the stage', async () => {
    const runs = testApp.app.get(RunService);
    const { channel, version } = await createVersion(
      [textStage({ model: { provider: 'fake', modelId: 'fake-text-1', params: {} } })],
      { model: { params: { max_tokens: 256 } } },
    );

    await expect(
      runs.create({
        channelId: channel.id,
        blueprintVersionId: version.id,
        inputs: {},
        roleBindings: {},
        budgetCapUsd: 10,
      }),
    ).resolves.toBeDefined();
  });

  it('does not require max_tokens for a non-text capability', async () => {
    const runs = testApp.app.get(RunService);
    const { channel, version } = await createVersion([
      {
        key: 'publish',
        label: 'Publish',
        capability: 'publish.stub',
        config: {},
        slots: {},
        context: {},
        output: { kind: 'data', schema: { type: 'object' } },
        checks: [],
        retryLimit: 0,
      },
    ]);

    await expect(
      runs.create({
        channelId: channel.id,
        blueprintVersionId: version.id,
        inputs: {},
        roleBindings: {},
        budgetCapUsd: 10,
      }),
    ).resolves.toBeDefined();
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
