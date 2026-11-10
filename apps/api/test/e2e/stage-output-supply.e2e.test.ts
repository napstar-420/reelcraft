import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { InngestTestEngine } from '@inngest/test';
import { UnprocessableEntityException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { StageDef, type CreateBlueprintVersionDto, type Probe } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import { RunStagePlanService } from '../../src/run/run-stage-plan.service';
import { HumanActionService } from '../../src/run/human-action.service';
import { StageOutputSupplyService } from '../../src/run/stage-output-supply.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import {
  artifact,
  blob,
  run,
  runMemory,
  runWakeup,
  stageAttempt,
  stageEvent,
  stageItem,
} from '../../src/db/schema';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

const IMAGE_PROBE: Probe = {
  container: 'png_pipe',
  durationSec: 0,
  streams: [{ type: 'video', codec: 'png', width: 1, height: 1, fps: 1 }],
};
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
const reads = { dependsOn: ['draft'], context: { draft: { from: 'stage', stageKey: 'draft' } } };

/** Supplying an output replaces what a stage generates: the contract is always validated, checks
 * and quality review run unless skipped, and what comes after goes out of date without running. */
describe('Supply a stage output (e2e)', () => {
  let database: TestDb;
  let app: TestApp;
  let runs: RunService;
  let plans: RunStagePlanService;
  let supply: StageOutputSupplyService;
  let runner: StageRunnerService;
  beforeAll(async () => {
    database = await createTestDb();
    app = await buildTestApp(database, {
      mediaProbe: {
        probe: async () => IMAGE_PROBE,
        hasAudio: (probe) => probe.streams.some((stream) => stream.type === 'audio'),
      },
    });
    runs = app.app.get(RunService);
    plans = app.app.get(RunStagePlanService);
    supply = app.app.get(StageOutputSupplyService);
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
      .create('local', { name: `Supply ${Math.random()}`, theme: {}, defaults: {} });
    const blueprints = app.app.get(BlueprintService);
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Supply');
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

  /** Candidate, then the plan that makes it the stage's output. */
  async function use(
    runId: string,
    versionId: string,
    stageKey: string,
    value: unknown,
    options: { skip?: boolean; itemIndex?: number; by?: 'user' | 'assistant' } = {},
  ) {
    const { artifactId } = await supply.createCandidate(
      runId,
      stageKey,
      {
        blueprintVersionId: versionId,
        value,
        ...(options.itemIndex !== undefined && { itemIndex: options.itemIndex }),
      },
      { by: options.by ?? 'user' },
    );
    const request = {
      blueprintVersionId: versionId,
      action: 'rerun' as const,
      mode: 'supply' as const,
      scope: 'stage' as const,
      stageKey,
      artifactId,
      ...(options.skip && { skipValidation: true }),
      ...(options.itemIndex !== undefined && { itemIndex: options.itemIndex }),
    };
    const plan = await plans.preview(runId, request);
    expect(plan.blockedReason).toBeNull();
    await plans.confirm(runId, { ...request, previewToken: plan.previewToken });
    return { artifactId, plan };
  }

  const states = async (runId: string) =>
    (await runs.get(runId)).stageExecutions.map((e) => e.state);
  const activeOf = async (runId: string, stageKey: string) =>
    (
      await database.db
        .select()
        .from(artifact)
        .where(
          and(
            eq(artifact.runId, runId),
            eq(artifact.producerStageKey, stageKey),
            eq(artifact.stale, false),
          ),
        )
    )[0];

  it('uses a supplied text output after its checks pass, leaving later stages out of date but not running', async () => {
    const { runId, version } = await fixture([
      text('draft', { writes: { draftText: '$' } }),
      text('final', reads),
    ]);
    await drive(runId, ['draft', 'final']);
    const generated = await activeOf(runId, 'final');
    const { artifactId, plan } = await use(runId, version.id, 'draft', 'my own words');
    expect(plan.runStageKeys).toEqual(['draft']);
    expect(plan.invalidatedStageKeys).toEqual(['final']);
    await drive(runId, ['draft']);

    expect(await states(runId)).toEqual(['passed', 'stale']);
    expect((await activeOf(runId, 'draft'))?.id).toBe(artifactId);
    expect((await activeOf(runId, 'draft'))?.data).toEqual({ text: 'my own words' });
    // Later stages weren't regenerated: their old output is only stale.
    expect(await activeOf(runId, 'final')).toBeUndefined();
    const [old] = await database.db.select().from(artifact).where(eq(artifact.id, generated!.id));
    expect(old?.stale).toBe(true);
    expect((await runs.get(runId)).blueprintVersionId).toBe(version.id);
    const memory = await database.db.select().from(runMemory).where(eq(runMemory.runId, runId));
    expect(memory.some((m) => m.memKey === 'draftText' && !m.tombstone)).toBe(true);
    const events = await database.db
      .select()
      .from(stageEvent)
      .where(and(eq(stageEvent.runId, runId), eq(stageEvent.type, 'stage.output_supplied')));
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({ artifactId, by: 'user', skipValidation: false });
    const view = await runs.stageOutput(runId, 'draft');
    expect(view.items[0]?.artifact.origin).toEqual({ by: 'user', validation: 'run' });
  });

  it('runs the checks by default and sends a failing output to review; skipping them uses it', async () => {
    const { runId, version } = await fixture([text('draft', { checks: [fail] })]);
    await drive(runId, ['draft']).catch(() => undefined);
    // The generated output failed its checks until the retries ran out; supply one anyway.
    await use(runId, version.id, 'draft', 'no felines here');
    await drive(runId, ['draft']);
    let detail = await runs.get(runId);
    expect(detail.state).toBe('PAUSED_APPROVAL');
    expect(detail.stageExecutions[0]?.state).toBe('awaiting_approval');
    const [newest] = await database.db
      .select()
      .from(stageAttempt)
      .where(eq(stageAttempt.stageExecutionId, detail.stageExecutions[0]!.id))
      .orderBy(desc(stageAttempt.attemptNo))
      .limit(1);
    expect(newest?.outcome).toBe('awaiting_approval');
    await app.app.get(HumanActionService).approve(runId, 'draft');
    expect(await states(runId)).toEqual(['passed']);

    // Again, but skipping the checks: it passes at once.
    await drive(runId, []);
    const { artifactId } = await use(runId, version.id, 'draft', 'still no felines', {
      skip: true,
    });
    await drive(runId, ['draft']);
    detail = await runs.get(runId);
    expect(detail.stageExecutions[0]?.state).toBe('passed');
    expect((await activeOf(runId, 'draft'))?.id).toBe(artifactId);
    const [skipped] = await database.db
      .select()
      .from(stageAttempt)
      .where(eq(stageAttempt.artifactId, artifactId));
    expect(skipped).toMatchObject({ outcome: 'success' });
    expect(skipped?.checkResults).toEqual([]);
    expect((await runs.stageOutput(runId, 'draft')).items[0]?.artifact.origin).toEqual({
      by: 'user',
      validation: 'skip',
    });
  });

  it('always validates the output contract, even when checks would be skipped', async () => {
    const data = text('draft', {
      output: {
        kind: 'data',
        schema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
      },
      model: { provider: 'fake', modelId: 'fake-text-1', params: { fakeOutput: { n: 1 } } },
    });
    const { runId, version } = await fixture([data]);
    await drive(runId, ['draft']);
    await expect(
      supply.createCandidate(
        runId,
        'draft',
        { blueprintVersionId: version.id, value: { n: 'one' } },
        { by: 'user' },
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      supply.createCandidate(
        runId,
        'draft',
        { blueprintVersionId: version.id, value: { n: 2 }, itemIndex: 0 },
        { by: 'user' },
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await use(runId, version.id, 'draft', { n: 2 }, { skip: true });
    await drive(runId, ['draft']);
    expect((await activeOf(runId, 'draft'))?.data).toEqual({ n: 2 });
  });

  it("keeps the approval for assistant-supplied outputs but not for a person's own", async () => {
    const gated = (extra: Record<string, unknown> = {}) =>
      text('draft', { approval: { mode: 'stage' }, ...extra });
    const { runId, version } = await fixture([gated()]);
    await drive(runId, ['draft']);
    await app.app.get(HumanActionService).approve(runId, 'draft');
    await drive(runId, []);
    await use(runId, version.id, 'draft', 'by me');
    await drive(runId, ['draft']);
    expect(await states(runId)).toEqual(['passed']);

    await drive(runId, []);
    await use(runId, version.id, 'draft', 'by the assistant', { by: 'assistant' });
    await drive(runId, ['draft']);
    expect(await states(runId)).toEqual(['awaiting_approval']);
    expect((await runs.get(runId)).state).toBe('PAUSED_APPROVAL');
  });

  it('supplies one item of an iterating stage', async () => {
    const list = text('list', {
      checks: [],
      output: { kind: 'data', schema: { type: 'array', items: { type: 'string' } } },
      model: { provider: 'fake', modelId: 'fake-text-1', params: { fakeOutput: ['a', 'b'] } },
    });
    const shots = StageDef.parse({
      ...text('shots', { dependsOn: ['list'] }),
      iterate: { over: { from: 'stage', stageKey: 'list' }, itemAlias: 'shot', itemRetryLimit: 0 },
      slots: { shot: { from: 'item' } },
    });
    const { runId, version } = await fixture([list, shots]);
    await drive(runId, ['list', 'shots'], 2);
    const before = (await runs.stageOutput(runId, 'shots')).items;
    await expect(
      supply.createCandidate(
        runId,
        'shots',
        { blueprintVersionId: version.id, value: 'x' },
        { by: 'user' },
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    const { artifactId } = await use(runId, version.id, 'shots', 'second, by hand', {
      itemIndex: 1,
    });
    await drive(runId, ['shots'], 2);
    const [execution] = (await runs.get(runId)).stageExecutions.filter(
      (e) => e.stageKey === 'shots',
    );
    const items = await database.db
      .select()
      .from(stageItem)
      .where(eq(stageItem.stageExecutionId, execution!.id))
      .orderBy(stageItem.itemIndex);
    expect(items.map((i) => i.state)).toEqual(['passed', 'passed']);
    expect(items[1]?.outputArtifactId).toBe(artifactId);
    expect(items[0]?.outputArtifactId).toBe(before.find((i) => i.itemIndex === 0)?.artifact.id);
  });

  it('uses another output of the same owner as a media output and frees its file from collection', async () => {
    const image = (key: string, extra: Record<string, unknown> = {}): StageDef =>
      StageDef.parse({
        key,
        label: key,
        capability: 'image.generate',
        config: {},
        slots: {},
        context: {},
        output: { kind: 'media.image' },
        checks: [],
        retryLimit: 0,
        model: { provider: 'fake', modelId: 'fake-image-1', params: {} },
        ...extra,
      });
    const { runId, version } = await fixture([image('a'), image('b', { dependsOn: [] })]);
    await drive(runId, ['a', 'b']);
    const source = await activeOf(runId, 'a');
    const supplyWith = (blueprintVersionId: string) =>
      supply.createCandidate(
        runId,
        'b',
        { blueprintVersionId, files: [{ artifactId: source!.id }] },
        { by: 'user' },
      );
    const { artifactId } = await supplyWith(version.id);
    const [candidate] = await database.db
      .select()
      .from(artifact)
      .where(eq(artifact.id, artifactId));
    expect(candidate).toMatchObject({ kind: 'media.image', stale: true, userAuthored: true });
    expect(candidate?.blobId).not.toBe(source?.blobId);
    const [candidateBlob] = await database.db
      .select()
      .from(blob)
      .where(eq(blob.id, candidate!.blobId!));
    // Abandoned until confirmed: a sweep may collect it (the row stays, only the file goes).
    expect(candidateBlob).toMatchObject({ scope: 'run', gcEligible: true });
    expect(candidateBlob?.gcEligibleAt).not.toBeNull();

    const request = {
      blueprintVersionId: version.id,
      action: 'rerun' as const,
      mode: 'supply' as const,
      scope: 'stage' as const,
      stageKey: 'b',
      artifactId,
    };
    const plan = await plans.preview(runId, request);
    await plans.confirm(runId, { ...request, previewToken: plan.previewToken });
    const [kept] = await database.db.select().from(blob).where(eq(blob.id, candidate!.blobId!));
    expect(kept).toMatchObject({ gcEligible: false, gcEligibleAt: null });
    await drive(runId, ['b']);
    expect((await activeOf(runId, 'b'))?.id).toBe(artifactId);
    // One candidate can't be used twice.
    expect((await plans.preview(runId, request)).blockedReason).toBe(
      'The output to use is no longer available. Supply it again.',
    );
    await expect(
      supply.createCandidate(
        runId,
        'b',
        { blueprintVersionId: version.id, files: [{ artifactId: 'not-mine' }] },
        { by: 'user' },
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('frees the files of a candidate that fails after they were stored', async () => {
    const image = StageDef.parse({
      key: 'a',
      label: 'a',
      capability: 'image.generate',
      config: {},
      slots: {},
      context: {},
      output: { kind: 'media.image' },
      checks: [],
      retryLimit: 0,
      model: { provider: 'fake', modelId: 'fake-image-1', params: {} },
    });
    // A video must carry sound by default, and the stored image has none: the output contract
    // refuses it only after the file was stored.
    const video = StageDef.parse({
      ...image,
      key: 'b',
      label: 'b',
      capability: 'video.generate',
      output: { kind: 'media.video' },
      model: { provider: 'fake', modelId: 'fake-video-1', params: {} },
      dependsOn: [],
      // Never run: only its output contract is exercised.
      disabled: true,
    });
    const { runId, version } = await fixture([image, video]);
    await drive(runId, ['a']);
    const source = await activeOf(runId, 'a');
    const before = await database.db.select().from(blob).where(eq(blob.runId, runId));
    await expect(
      supply.createCandidate(
        runId,
        'b',
        { blueprintVersionId: version.id, files: [{ artifactId: source!.id }] },
        { by: 'user' },
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    const added = (await database.db.select().from(blob).where(eq(blob.runId, runId))).filter(
      (row) => !before.some((old) => old.id === row.id),
    );
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ gcEligible: true });
    expect(added[0]?.gcEligibleAt).not.toBeNull();
  });

  it('stales a supplied output when an upstream stage is re-run', async () => {
    const { runId, version } = await fixture([text('draft'), text('final', reads)]);
    await drive(runId, ['draft', 'final']);
    await use(runId, version.id, 'final', 'hand-made ending');
    await drive(runId, ['final']);
    expect(await states(runId)).toEqual(['passed', 'passed']);
    const request = {
      blueprintVersionId: version.id,
      action: 'rerun' as const,
      mode: 'reuse' as const,
      scope: 'stage' as const,
      stageKey: 'draft',
    };
    const plan = await plans.preview(runId, request);
    expect(plan.invalidatedStageKeys).toEqual(['final']);
    await plans.confirm(runId, { ...request, previewToken: plan.previewToken });
    await drive(runId, ['draft']);
    expect(await states(runId)).toEqual(['passed', 'stale']);
  });
});
