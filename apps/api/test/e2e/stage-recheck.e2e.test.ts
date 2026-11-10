import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { InngestTestEngine } from '@inngest/test';
import { and, desc, eq } from 'drizzle-orm';
import { StageDef, type CreateBlueprintVersionDto } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import { RunStagePlanService } from '../../src/run/run-stage-plan.service';
import { HumanActionService } from '../../src/run/human-action.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import {
  artifact,
  run,
  runMemory,
  runWakeup,
  stageAttempt,
  stageEvent,
  stageExecution,
  stageItem,
} from '../../src/db/schema';
import { mockQcOutcomes } from '../support/mock-qc-outcomes';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

const pass = { type: 'script' as const, name: 'has text', code: 'return { pass: true };' };
const fail = {
  type: 'script' as const,
  name: 'mentions cats',
  code: "return { pass: false, message: 'no cats' };",
};
const text = (key: string, extra: Record<string, unknown> = {}): StageDef =>
  StageDef.parse({
    key,
    label: key,
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [pass],
    retryLimit: 0,
    model: { provider: 'fake', modelId: 'fake-text-1', params: { fakeOutput: `${key} out` } },
    ...extra,
  });
const judge = {
  criteria: 'be good',
  threshold: 70,
  includeInputs: false,
  model: { provider: 'fake', modelId: 'fake-text-1', params: {} },
};
const reads = { dependsOn: ['draft'], context: { draft: { from: 'stage', stageKey: 'draft' } } };
const yes = {
  status: 'passed' as const,
  verdict: { score: 90, critique: 'good', dimensions: [] },
  costUsd: 0.01,
};

/** Re-check judges a stage's (or item's) stored output again, in place: nothing is
 * generated, the output stays current and later stages keep theirs. */
describe('Re-check output (e2e)', () => {
  let database: TestDb;
  let app: TestApp;
  let runs: RunService;
  let plans: RunStagePlanService;
  let runner: StageRunnerService;
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
  afterEach(() => vi.restoreAllMocks());

  const definition = (graph: StageDef[]): CreateBlueprintVersionDto => ({
    graph,
    inputs: [],
    roles: [],
    defaults: {},
    budget: { runCapUsd: 100 },
  });

  async function fixture(graph: StageDef[]) {
    const channel = await app.app
      .get(ChannelService)
      .create('local', { name: `Recheck ${Math.random()}`, theme: {}, defaults: {} });
    const blueprints = app.app.get(BlueprintService);
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Recheck');
    const version = await blueprints.createVersion(blueprintId, definition(graph));
    const created = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 100,
      rerunStageKeys: [],
    });
    await database.db.update(run).set({ state: 'IDLE' }).where(eq(run.id, created.id));
    const request = {
      blueprintVersionId: version.id,
      action: 'run' as const,
      mode: 'reuse' as const,
      scope: 'stage' as const,
    };
    const plan = await plans.preview(created.id, request);
    await plans.confirm(created.id, { ...request, previewToken: plan.previewToken });
    return { runId: created.id, version, blueprintId };
  }

  /** Runs the orchestrator once, executing `keys` (iterating stages run `items` items). */
  async function drive(runId: string, keys: string[], items = 0) {
    const detail = await runs.get(runId);
    const [wakeup] = await database.db
      .select()
      .from(runWakeup)
      .where(and(eq(runWakeup.runId, runId), eq(runWakeup.expectedRevision, detail.revision!)))
      .orderBy(desc(runWakeup.createdAt))
      .limit(1);
    const epoch = detail.executionEpoch;
    const result = await new InngestTestEngine({
      function: app.functions.find((f) => f.id() === 'run.orchestrate')!,
      events: [
        {
          name: wakeup?.eventName ?? 'run/started',
          data: {
            runId,
            executionEpoch: epoch,
            executionKey: `${runId}:${epoch}`,
            ...(wakeup && {
              wakeupId: wakeup.id,
              action: wakeup.action,
              sourceState: wakeup.sourceState,
              expectedRevision: wakeup.expectedRevision,
            }),
          },
        },
      ],
      steps: keys.map((key) => ({
        id: `invoke-stage-${key}`,
        handler: async () => {
          const execution = detail.stageExecutions.find((e) => e.stageKey === key)!;
          const executed = await new InngestTestEngine({
            function: app.functions.find((f) => f.id() === 'stage.execute')!,
            events: [
              {
                name: 'stage/execute.requested',
                data: {
                  runId,
                  stageExecutionId: execution.id,
                  stageKey: key,
                  executionEpoch: epoch,
                  executionKey: `${runId}:${epoch}`,
                },
              },
            ],
            steps: Array.from({ length: items }, (_, index) => ({
              id: `run-item-${index}`,
              handler: async () => {
                const saved = await runner.itemState(execution.id, index);
                const item = await new InngestTestEngine({
                  function: app.functions.find((f) => f.id() === 'stage.execute.item')!,
                  events: [
                    {
                      name: 'stage/execute.item.requested',
                      data: {
                        runId,
                        stageExecutionId: execution.id,
                        stageKey: key,
                        itemIndex: index,
                        stageItemId: saved.id,
                        executionEpoch: epoch,
                        executionKey: `${runId}:${epoch}`,
                      },
                    },
                  ],
                }).execute();
                if (item.error) throw item.error;
                return item.result;
              },
            })),
          }).execute();
          if (executed.error) throw executed.error;
          return executed.result;
        },
      })),
    }).execute();
    expect(result.error).toBeUndefined();
    return result.result;
  }

  const recheckRequest = (blueprintVersionId: string, stageKey: string, itemIndex?: number) => ({
    blueprintVersionId,
    action: 'rerun' as const,
    mode: 'validate' as const,
    scope: 'stage' as const,
    stageKey,
    ...(itemIndex !== undefined && { itemIndex }),
  });

  async function recheck(
    runId: string,
    blueprintVersionId: string,
    stageKey: string,
    item?: number,
  ) {
    const request = recheckRequest(blueprintVersionId, stageKey, item);
    const plan = await plans.preview(runId, request);
    expect(plan.blockedReason).toBeNull();
    await plans.confirm(runId, { ...request, previewToken: plan.previewToken });
    return plan;
  }

  const execution = async (runId: string, stageKey: string) =>
    (await runs.get(runId)).stageExecutions.find((e) => e.stageKey === stageKey)!;
  const activeArtifacts = (runId: string) =>
    database.db
      .select({ id: artifact.id, stageKey: artifact.producerStageKey })
      .from(artifact)
      .where(and(eq(artifact.runId, runId), eq(artifact.stale, false)));

  it('re-checks an output with no edits, keeping it and every later stage as they are', async () => {
    mockQcOutcomes(runner, yes);
    const { runId, version } = await fixture([
      text('draft', { qc: judge, writes: { draftText: '$' } }),
      text('final', reads),
    ]);
    await drive(runId, ['draft', 'final']);
    expect((await runs.get(runId)).state).toBe('COMPLETED');
    expect((await execution(runId, 'draft')).availableActions?.recheck).toBe(true);
    const before = await activeArtifacts(runId);
    const artifactCount = (
      await database.db.select().from(artifact).where(eq(artifact.runId, runId))
    ).length;
    const memoryBefore = await database.db
      .select()
      .from(runMemory)
      .where(eq(runMemory.runId, runId));

    const plan = await recheck(runId, version.id, 'draft');
    expect(plan.runStageKeys).toEqual(['draft']);
    expect(plan.invalidatedStageKeys).toEqual([]);
    expect(plan.estimatedRerunUsd).toBeCloseTo(0.01);
    // Downstream stays passed while the re-check is queued.
    expect((await execution(runId, 'final')).state).toBe('passed');
    await drive(runId, ['draft']);

    const after = await runs.get(runId);
    expect(after.state).toBe('COMPLETED');
    expect(after.blueprintVersionId).toBe(version.id);
    expect(after.stageExecutions.map((e) => e.state)).toEqual(['passed', 'passed']);
    expect(await activeArtifacts(runId)).toEqual(before);
    expect(
      (await database.db.select().from(artifact).where(eq(artifact.runId, runId))).length,
    ).toBe(artifactCount);
    expect(await database.db.select().from(runMemory).where(eq(runMemory.runId, runId))).toEqual(
      memoryBefore,
    );
    const [newest] = await database.db
      .select()
      .from(stageAttempt)
      .where(eq(stageAttempt.stageExecutionId, (await execution(runId, 'draft')).id))
      .orderBy(desc(stageAttempt.attemptNo))
      .limit(1);
    expect(newest).toMatchObject({ outcome: 'success', actor: 'user', phase: 'settled' });
    expect(newest?.artifactId).toBe(before.find((a) => a.stageKey === 'draft')?.id);
    expect(newest?.qcVerdict).toMatchObject({ score: 90 });
    const events = await database.db
      .select({ message: stageEvent.message })
      .from(stageEvent)
      .where(and(eq(stageEvent.runId, runId), eq(stageEvent.type, 'stage.execution_plan')));
    expect(events.map((e) => e.message)).toContain('Re-checking the stored output');
  });

  it('sends a failing re-check to review: Approve keeps the output, Reject regenerates it', async () => {
    const { runId, blueprintId } = await fixture([text('draft'), text('final', reads)]);
    await drive(runId, ['draft', 'final']);
    const [kept] = (await activeArtifacts(runId)).filter((a) => a.stageKey === 'draft');
    // A stricter check, edited on the canvas: a validation edit, so the output isn't stale.
    const stricter = await app.app
      .get(BlueprintService)
      .createVersion(
        blueprintId,
        definition([text('draft', { checks: [fail] }), text('final', reads)]),
        { draft: true },
      );
    await recheck(runId, stricter.id, 'draft');
    await drive(runId, ['draft']);
    let detail = await runs.get(runId);
    expect(detail.state).toBe('PAUSED_APPROVAL');
    expect(detail.stageExecutions.map((e) => e.state)).toEqual(['awaiting_approval', 'passed']);
    const candidate = await runs.approvalCandidate(runId, 'draft');
    expect(candidate?.artifact?.id).toBe(kept!.id);

    await app.app.get(HumanActionService).approve(runId, 'draft');
    detail = await runs.get(runId);
    expect(detail.stageExecutions.map((e) => e.state)).toEqual(['passed', 'passed']);
    expect((await activeArtifacts(runId)).find((a) => a.stageKey === 'draft')?.id).toBe(kept!.id);

    // The run now pins the stricter check, so a second re-check fails again; this time reject.
    await drive(runId, []);
    expect((await runs.get(runId)).state).toBe('COMPLETED');
    await recheck(runId, (await runs.get(runId)).blueprintVersionId, 'draft');
    await drive(runId, ['draft']);
    const humans = app.app.get(HumanActionService);
    const preview = (await humans.reject(runId, 'draft', 'Mention cats')) as {
      previewToken: string;
      affectedStageKeys: string[];
    };
    expect(preview.affectedStageKeys).toEqual(['draft', 'final']);
    await humans.reject(runId, 'draft', 'Mention cats', preview.previewToken);
    detail = await runs.get(runId);
    expect(detail.stageExecutions.map((e) => e.state)).toEqual(['stale', 'stale']);
  });

  it('re-checks one item, or every item of a stage, without reopening its stage approval', async () => {
    mockQcOutcomes(runner, yes);
    const shots = StageDef.parse({
      ...text('shots', { dependsOn: ['list'], qc: judge }),
      iterate: { over: { from: 'stage', stageKey: 'list' }, itemAlias: 'shot', itemRetryLimit: 0 },
      slots: { shot: { from: 'item' } },
      approval: { mode: 'stage' },
    });
    const list = text('list', {
      checks: [],
      output: { kind: 'data', schema: { type: 'array', items: { type: 'string' } } },
      model: { provider: 'fake', modelId: 'fake-text-1', params: { fakeOutput: ['a', 'b', 'c'] } },
    });
    const { runId, version } = await fixture([list, shots]);
    await drive(runId, ['list', 'shots'], 3);
    expect((await runs.get(runId)).state).toBe('PAUSED_APPROVAL');
    await app.app.get(HumanActionService).approve(runId, 'shots');
    await drive(runId, []);
    const shotsExecution = await execution(runId, 'shots');
    expect(shotsExecution.state).toBe('passed');
    expect(shotsExecution.availableActions?.recheck).toBe(true);
    const itemsBefore = await database.db
      .select()
      .from(stageItem)
      .where(eq(stageItem.stageExecutionId, shotsExecution.id))
      .orderBy(stageItem.itemIndex);
    const attempts = async () =>
      database.db
        .select()
        .from(stageAttempt)
        .where(eq(stageAttempt.stageExecutionId, shotsExecution.id));
    const attemptCount = (await attempts()).length;

    await recheck(runId, version.id, 'shots', 1);
    await drive(runId, ['shots'], 3);
    expect((await execution(runId, 'shots')).state).toBe('passed');
    expect((await attempts()).length).toBe(attemptCount + 1);

    expect((await runs.get(runId)).state).toBe('COMPLETED');
    const plan = await recheck(runId, version.id, 'shots');
    expect(plan.estimatedRerunUsd).toBeCloseTo(0.03);
    await drive(runId, ['shots'], 3);
    const after = await runs.get(runId);
    expect(after.stageExecutions.find((e) => e.stageKey === 'shots')?.state).toBe('passed');
    expect((await attempts()).length).toBe(attemptCount + 4);
    const itemsAfter = await database.db
      .select()
      .from(stageItem)
      .where(eq(stageItem.stageExecutionId, shotsExecution.id))
      .orderBy(stageItem.itemIndex);
    expect(itemsAfter.map((i) => [i.state, i.outputArtifactId])).toEqual(
      itemsBefore.map((i) => ['passed', i.outputArtifactId]),
    );
  });

  it('blocks a re-check once the stage itself changed, or before it has passed', async () => {
    const { runId, blueprintId, version } = await fixture([text('draft')]);
    const changed = await app.app
      .get(BlueprintService)
      .createVersion(
        blueprintId,
        definition([text('draft', { instructions: { template: 'new' } })]),
        { draft: true },
      );
    expect((await plans.preview(runId, recheckRequest(version.id, 'draft'))).blockedReason).toBe(
      'Re-check needs a stage that has finished.',
    );
    await drive(runId, ['draft']);
    expect((await plans.preview(runId, recheckRequest(changed.id, 'draft'))).blockedReason).toBe(
      'This stage changed since its output was made. Re-run it to apply the change.',
    );
    const [row] = await database.db
      .select()
      .from(stageExecution)
      .where(and(eq(stageExecution.runId, runId), eq(stageExecution.stageKey, 'draft')));
    expect(row?.state).toBe('passed');
  });
});
