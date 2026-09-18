import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InngestTestEngine } from '@inngest/test';
import { eq } from 'drizzle-orm';
import { LedgerService } from '../../src/budget/ledger.service';
import { ulid } from '../../src/common/ulid';
import { run, ledgerEntry, stageAttempt } from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';
import { RunService } from '../../src/run/run.service';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import type { StageDef } from '@reefcraft/shared';

function stage(key: string): StageDef {
  return {
    key,
    label: key,
    capability: 'llm.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    retryLimit: 0,
    model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 256 } },
  };
}

/**
 * §11.4 — proves `budget.sweep`'s WIRING (it's registered, invokable, and
 * calls through to `LedgerService.sweepExpiredReservations`), not its
 * algorithm (already covered directly, without Inngest, in
 * `budget-ledger.e2e.test.ts`).
 */
describe('budget.sweep (real Inngest function, e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;
  let budgetSweepFn: TestApp['functions'][number];

  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb);
    const fn = testApp.functions.find((f) => f.id() === 'budget.sweep');
    if (!fn) throw new Error('budget.sweep function not found');
    budgetSweepFn = fn;
  });

  afterAll(async () => {
    try {
      await testApp?.close();
    } finally {
      await testDb.teardown();
    }
  });

  it('sweeps a stale reservation when invoked', async () => {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);
    const ledger = testApp.app.get(LedgerService);

    const channel = await channels.create('local', {
      name: `Budget Sweep Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Budget Sweep Blueprint');
    const version = await blueprints.createVersion(blueprintId, {
      graph: [stage('outline')],
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    const createdRun = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 10,
    });
    const execution = createdRun.stageExecutions.find((e) => e.stageKey === 'outline');
    if (!execution) throw new Error('stage execution not found');
    await testDb.db.update(run).set({ state: 'RUNNING' }).where(eq(run.id, createdRun.id));

    const stageAttemptId = ulid();
    await testDb.db.insert(stageAttempt).values({
      id: stageAttemptId,
      stageExecutionId: execution.id,
      attemptNo: 1,
      outcome: 'success',
      resolvedInputs: {},
      phase: 'created',
      actor: 'engine',
    });
    const reserved = await ledger.reserve({
      runId: createdRun.id,
      stageKey: 'outline',
      stageAttemptId,
      category: 'stage_output',
      ceilingUsd: 3,
      preSubmitTtlSec: 600,
    });
    if (!reserved.ok) throw new Error('expected reserve to succeed');
    await testDb.db
      .update(ledgerEntry)
      .set({ expiresAt: new Date(Date.now() - 60_000).toISOString() })
      .where(eq(ledgerEntry.id, reserved.reservationId));

    const engine = new InngestTestEngine({ function: budgetSweepFn });
    const { error } = await engine.execute();

    expect(error).toBeUndefined();
    const [row] = await testDb.db.select().from(run).where(eq(run.id, createdRun.id));
    expect(row?.reservedUsd).toBe('0.0000');
  });
});
