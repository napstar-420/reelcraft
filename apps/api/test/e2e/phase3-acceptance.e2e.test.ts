import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InngestTestEngine, mockCtx } from '@inngest/test';
import type { Context } from 'inngest';
import { and, eq } from 'drizzle-orm';
import type { StageDef } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import type { StageExecuteEventData } from '../../src/orchestration/functions/stage-execute.fn';
import { toUsd } from '../../src/common/money';
import {
  ledgerEntry,
  run,
  runWakeup,
  stageAttempt,
  stageExecution,
} from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

/** See `stage-execute-inngest.e2e.test.ts` — `step.sleep` hangs
 * indefinitely under `InngestTestEngine`; only it is stubbed here.
 * `expensive`'s `slow:2` knob exercises real `step.sleep` calls on the
 * inner engine, so every inner engine below uses this. */
function skipSleepCtx(ctx: Context.Any): Context.Any {
  const mocked = mockCtx(ctx);
  (mocked.step.sleep as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(
    undefined,
  );
  return mocked;
}

const GRAPH: StageDef[] = [
  {
    key: 'cheap',
    label: 'Cheap',
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    retryLimit: 0,
    model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 256 } },
  },
  {
    key: 'expensive',
    label: 'Expensive',
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    retryLimit: 0,
    model: {
      provider: 'fake',
      modelId: 'fake-text-1:slow:2',
      params: { max_tokens: 256, fakeCeilingUsd: 5, fakeCostUsd: 4.5 },
    },
  },
];

/**
 * §24 item 3's acceptance criterion, end-to-end through the real
 * `run.orchestrate`/`stage.execute` Inngest functions (the same
 * dual-`InngestTestEngine` mechanism `phase2-acceptance.e2e.test.ts`
 * invented — each `invoke-stage-<key>` mock runs a second, independent
 * engine for the real `stage.execute` to completion): reserve -> a genuine
 * cap-hit -> `PAUSED_BUDGET` -> a budget raise -> `run/resumed` -> resumed
 * reservation success -> settle.
 *
 * `budgetCapUsd: 1` is tight enough that `expensive`'s `fakeCeilingUsd: 5`
 * is guaranteed to exceed `runAvailable` after `cheap` settles (its own
 * ceiling, ~$0.003, leaves plenty of room) — deterministically forcing
 * `run_cap_exceeded`, not `stage_cap_exceeded` (which has no recovery path
 * until phase 4's `run.overrides` patching — see the phase-3 plan's Risk 4).
 */
describe('phase 3 acceptance: reserve, cap-hit, PAUSED_BUDGET, raise, resume, settle (e2e)', () => {
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

  function invokeStageFor(data: StageExecuteEventData) {
    return async () => {
      const inner = new InngestTestEngine({
        function: stageExecuteFn,
        events: [{ name: 'stage/execute.requested', data }],
        transformCtx: skipSleepCtx,
      });
      const { result, error } = await inner.execute();
      if (error) throw error;
      return result;
    };
  }

  it('runs reserve -> cap-hit -> PAUSED_BUDGET -> raise -> resume -> settle end-to-end through the real Inngest functions', async () => {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);

    const channel = await channels.create('local', {
      name: `Phase 3 Acceptance Channel ${Date.now()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(
      channel.id,
      'Phase 3 Acceptance Blueprint',
    );
    const version = await blueprints.createVersion(blueprintId, {
      graph: GRAPH,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    expect(version.runnable).toBe(true);

    const createdRun = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 1,
    });
    const cheapExecution = createdRun.stageExecutions.find((e) => e.stageKey === 'cheap');
    const expensiveExecution = createdRun.stageExecutions.find((e) => e.stageKey === 'expensive');
    if (!cheapExecution || !expensiveExecution) throw new Error('stage execution not found');

    // 1. run/started — cheap settles for real; expensive's real reserve()
    // hits run_cap_exceeded, bubbling up as budget_blocked.
    const firstRun = await new InngestTestEngine({
      function: runOrchestrateFn,
      events: [{ name: 'run/started', data: { runId: createdRun.id } }],
      steps: [
        {
          id: 'invoke-stage-cheap',
          handler: invokeStageFor({
            runId: createdRun.id,
            stageExecutionId: cheapExecution.id,
            stageKey: 'cheap',
          }),
        },
        {
          id: 'invoke-stage-expensive',
          handler: invokeStageFor({
            runId: createdRun.id,
            stageExecutionId: expensiveExecution.id,
            stageKey: 'expensive',
          }),
        },
      ],
    }).execute();

    expect(firstRun.error).toBeUndefined();
    expect(firstRun.result).toEqual({ state: 'PAUSED_BUDGET' });

    const [pausedRow] = await testDb.db.select().from(run).where(eq(run.id, createdRun.id));
    expect(pausedRow?.state).toBe('PAUSED_BUDGET');
    expect(pausedRow?.cursorStageKey).toBe('expensive');
    expect(pausedRow?.endedAt).toBeNull();

    const expensiveOutputEntriesBeforeRaise = await testDb.db
      .select()
      .from(ledgerEntry)
      .where(
        and(
          eq(ledgerEntry.runId, createdRun.id),
          eq(ledgerEntry.stageKey, 'expensive'),
          eq(ledgerEntry.category, 'stage_output'),
        ),
      );
    expect(expensiveOutputEntriesBeforeRaise).toHaveLength(0); // the blocked reserve wrote nothing

    // 2. Raise the cap, then resume.
    await runs.raiseBudget(createdRun.id, 10);
    await runs.resume(createdRun.id);

    const [resumedRow] = await testDb.db.select().from(run).where(eq(run.id, createdRun.id));
    expect(resumedRow?.state).toBe('PAUSED_BUDGET');
    const [resumeWakeup] = await testDb.db
      .select()
      .from(runWakeup)
      .where(eq(runWakeup.runId, createdRun.id))
      .limit(1);
    if (!resumeWakeup) throw new Error('resume wakeup missing');

    // 3. run/resumed — cheap must never be re-invoked (already passed);
    // expensive's real reserve() now succeeds under the raised cap, its
    // slow:2 knob drives two real backoff cycles, and it settles.
    const secondRun = await new InngestTestEngine({
      function: runOrchestrateFn,
      events: [
        {
          name: 'run/resumed',
          data: {
            runId: createdRun.id,
            wakeupId: resumeWakeup.id,
            action: resumeWakeup.action,
            sourceState: resumeWakeup.sourceState,
            expectedRevision: resumeWakeup.expectedRevision,
          },
        },
      ],
      steps: [
        {
          id: 'invoke-stage-cheap',
          handler: () => {
            throw new Error('regression: an already-passed stage was re-invoked');
          },
        },
        {
          id: 'invoke-stage-expensive',
          handler: invokeStageFor({
            runId: createdRun.id,
            stageExecutionId: expensiveExecution.id,
            stageKey: 'expensive',
          }),
        },
      ],
    }).execute();

    expect(secondRun.error).toBeUndefined();
    expect(secondRun.result).toEqual({ state: 'COMPLETED' });

    const [finalRow] = await testDb.db.select().from(run).where(eq(run.id, createdRun.id));
    expect(finalRow?.state).toBe('COMPLETED');
    expect(finalRow?.cursorStageKey).toBeNull();
    expect(finalRow?.endedAt).not.toBeNull();
    expect(toUsd(finalRow!.budgetCapUsd)).toBe(10);
    expect(toUsd(finalRow!.reservedUsd)).toBe(0);
    expect(toUsd(finalRow!.spentUsd)).toBe(4.501); // cheap's 0.001 + expensive's fakeCostUsd 4.5

    const expensiveAttempts = await testDb.db
      .select()
      .from(stageAttempt)
      .where(eq(stageAttempt.stageExecutionId, expensiveExecution.id))
      .orderBy(stageAttempt.attemptNo);
    expect(expensiveAttempts).toHaveLength(2);
    expect(expensiveAttempts[0]?.outcome).toBe('budget_blocked');
    expect(expensiveAttempts[1]?.outcome).toBe('success');

    const expensiveOutputEntries = await testDb.db
      .select()
      .from(ledgerEntry)
      .where(
        and(
          eq(ledgerEntry.runId, createdRun.id),
          eq(ledgerEntry.stageKey, 'expensive'),
          eq(ledgerEntry.category, 'stage_output'),
        ),
      );
    expect(expensiveOutputEntries).toHaveLength(3); // one reservation+actual+release triple
    expect(expensiveOutputEntries.filter((e) => e.kind === 'reservation')).toHaveLength(1);
    expect(expensiveOutputEntries.filter((e) => e.kind === 'actual')).toHaveLength(1);
    expect(expensiveOutputEntries.filter((e) => e.kind === 'release')).toHaveLength(1);

    const executions = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.runId, createdRun.id));
    expect(executions.every((e) => e.state === 'passed')).toBe(true);
  });
});
