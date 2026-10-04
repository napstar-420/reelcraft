import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { InngestTestEngine } from '@inngest/test';
import { and, eq } from 'drizzle-orm';
import type { StageDef } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import { RunWakeupDispatcher } from '../../src/run/run-wakeup-dispatcher.service';
import { RunWakeupClaimService } from '../../src/run/run-wakeup-claim.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { ProviderRegistry } from '../../src/provider/provider.registry';
import { INNGEST_CLIENT } from '../../src/orchestration/inngest.client';
import {
  artifact,
  artifactAttachment,
  run as runTable,
  runWakeup,
  stageAttempt,
} from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

const flowStage: StageDef = {
  key: 'flow',
  label: 'Flow clips',
  capability: 'browser.flow_video',
  instructions: { template: 'Make one clip per scene.' },
  config: { aspectRatio: '9:16' },
  slots: {},
  context: {},
  output: { kind: 'media.video_list' },
  checks: [],
  retryLimit: 1,
  model: { provider: 'codex', modelId: 'gpt-example', params: { reasoningEffort: 'low' } },
};

describe('Generate Video with Flow (e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;
  const files = mkdtemp(join(tmpdir(), 'reelcraft-flow-e2e-'));

  /** What the stubbed Codex adapter reports for the next fetch. */
  let fetched: { output: unknown; attachments?: unknown[] };
  /** What the stubbed judge answers when quality control calls Codex. */
  let judged: unknown = { score: 90, critique: 'Fine.' };
  const requests = new Map<string, { modality?: string }>();

  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb);
    const adapter = {
      id: 'codex',
      modalities: ['text', 'image', 'browser'],
      listModels: async () => [
        {
          modelId: 'gpt-example',
          label: 'Example',
          modalities: ['browser'],
          capabilities: {},
          supportedReasoningEfforts: ['low'],
          defaultReasoningEffort: 'low',
        },
      ],
      estimate: async () => ({ expectedUsd: 0, ceilingUsd: 0, basis: 'configured_ceiling' }),
      submit: async (request: { modality?: string }, key: string) => {
        requests.set(key, request);
        return { providerId: 'codex', externalId: key };
      },
      poll: async () => ({ done: true, outcome: 'succeeded' }),
      fetch: async (handle: { externalId: string }) =>
        (requests.get(handle.externalId)?.modality ?? 'text') === 'text'
          ? {
              output: JSON.stringify(judged),
              costUsd: 0,
              repro: { level: 'none' },
              rawResponse: {},
            }
          : { costUsd: 0, repro: { level: 'approximate' }, ...fetched },
      cancel: async () => ({ confirmed: true }),
    };
    const registry = testApp.app.get(ProviderRegistry);
    const get = registry.get.bind(registry);
    vi.spyOn(registry, 'get').mockImplementation((id: string) =>
      id === 'codex' ? (adapter as never) : get(id),
    );
  });

  afterAll(async () => {
    try {
      await testApp?.close();
    } finally {
      await testDb.teardown();
    }
  });

  async function setupRun(graph: StageDef[] = [flowStage]) {
    const channel = await testApp.app.get(ChannelService).create('local', {
      name: `Flow Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: { flow: { accounts: ['a@example.com', 'b@example.com'] } },
    });
    const blueprints = testApp.app.get(BlueprintService);
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Flow Blueprint');
    const version = await blueprints.createVersion(blueprintId, {
      graph,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    const run = await testApp.app.get(RunService).create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });
    await testDb.db.update(runTable).set({ state: 'RUNNING' }).where(eq(runTable.id, run.id));
    return run;
  }

  async function attempt(runId: string, stageExecutionId: string) {
    const runner = testApp.app.get(StageRunnerService);
    const { stage, effective, prevStageKey } = await runner.loadStageContext(runId, 'flow');
    const ctx = await runner.beginAttempt({ runId, stageExecutionId, stageKey: 'flow' });
    const submission = await runner.reserveAndSubmit(stage, ctx, prevStageKey, effective);
    if (submission.outcome !== 'submitted') throw new Error(submission.outcome);
    await runner.pollOnce(stage, submission.handle);
    return runner.fetchAndFinalize(stage, ctx, submission.handle, prevStageKey, effective);
  }

  it('does not let a Flow stage without a template prompt be run', async () => {
    const channel = await testApp.app.get(ChannelService).create('local', {
      name: `Flow Validate ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprints = testApp.app.get(BlueprintService);
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Flow Validate');
    const withoutTemplate = { ...flowStage, instructions: undefined };
    const dto = {
      graph: [withoutTemplate],
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    };

    const validated = await blueprints.validateOnly(blueprintId, dto);
    expect(validated.runnable).toBe(false);
    expect(validated.issues).toContainEqual(
      expect.objectContaining({
        path: expect.stringContaining('instructions.template'),
        severity: 'error',
      }),
    );
    expect(
      (await blueprints.validateOnly(blueprintId, { ...dto, graph: [flowStage] })).runnable,
    ).toBe(true);
  });

  it('defers when every account is out of credits, then pauses with a held-back wakeup and resumes', async () => {
    const createdRun = await setupRun();
    const execution = createdRun.stageExecutions.find((e) => e.stageKey === 'flow')!;
    fetched = {
      output: { status: 'credits_exhausted', resetAt: '', clips: [] },
      attachments: [],
    };

    const result = await attempt(createdRun.id, execution.id);
    expect(result.outcome).toBe('deferred');
    const resumeAt = (result as { resumeAt: string }).resumeAt;
    expect(Date.parse(resumeAt)).toBeGreaterThan(Date.now());

    const [attemptRow] = await testDb.db
      .select()
      .from(stageAttempt)
      .where(eq(stageAttempt.stageExecutionId, execution.id));
    expect(attemptRow?.outcome).toBe('deferred');
    expect(attemptRow?.phase).toBe('settled');

    // run.orchestrate turns the deferred outcome into the pause.
    const orchestrate = testApp.functions.find((f) => f.id() === 'run.orchestrate')!;
    const { result: state, error } = await new InngestTestEngine({
      function: orchestrate,
      events: [{ name: 'run/started', data: { runId: createdRun.id } }],
      steps: [{ id: 'invoke-stage-flow', handler: () => ({ outcome: 'deferred', resumeAt }) }],
    }).execute();
    expect(error).toBeUndefined();
    expect(state).toEqual({ state: 'PAUSED_QUOTA' });

    const [pausedRun] = await testDb.db
      .select()
      .from(runTable)
      .where(eq(runTable.id, createdRun.id));
    expect(pausedRun?.state).toBe('PAUSED_QUOTA');
    const [wakeup] = await testDb.db
      .select()
      .from(runWakeup)
      .where(eq(runWakeup.runId, createdRun.id));
    expect(wakeup).toMatchObject({
      action: 'resume',
      sourceState: 'PAUSED_QUOTA',
      expectedRevision: pausedRun?.revision,
      dispatchedAt: null,
    });
    expect(new Date(wakeup!.notBefore!).toISOString()).toBe(resumeAt);

    // The run detail tells the UI when it resumes.
    const detail = await testApp.app.get(RunService).get(createdRun.id);
    expect(detail.resumeAt).toBe(wakeup!.notBefore);

    // Held back until the reset time…
    const dispatcher = testApp.app.get(RunWakeupDispatcher);
    const send = vi.spyOn(testApp.app.get(INNGEST_CLIENT), 'send');
    send.mockClear();
    await dispatcher.dispatchPending();
    expect(send).not.toHaveBeenCalled();

    // …then sent, and claiming it puts the run back to RUNNING.
    await testDb.db
      .update(runWakeup)
      .set({ notBefore: new Date(Date.now() - 1000).toISOString() })
      .where(eq(runWakeup.id, wakeup!.id));
    await dispatcher.dispatchPending();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ id: wakeup!.id, name: 'run/resumed' }),
    );
    const claim = await testApp.app.get(RunWakeupClaimService).claim({
      wakeupId: wakeup!.id,
      runId: createdRun.id,
      action: 'resume',
      sourceState: 'PAUSED_QUOTA',
      expectedRevision: wakeup!.expectedRevision,
    });
    expect(claim.claimed).toBe(true);
    const [resumed] = await testDb.db.select().from(runTable).where(eq(runTable.id, createdRun.id));
    expect(resumed?.state).toBe('RUNNING');
  });

  it('a manual resume while paused makes the scheduled wakeup stale', async () => {
    const createdRun = await setupRun();
    const orchestrate = testApp.functions.find((f) => f.id() === 'run.orchestrate')!;
    const resumeAt = new Date(Date.now() + 3_600_000).toISOString();
    await new InngestTestEngine({
      function: orchestrate,
      events: [{ name: 'run/started', data: { runId: createdRun.id } }],
      steps: [{ id: 'invoke-stage-flow', handler: () => ({ outcome: 'deferred', resumeAt }) }],
    }).execute();

    await testApp.app.get(RunService).resume(createdRun.id);
    const wakeups = await testDb.db
      .select()
      .from(runWakeup)
      .where(eq(runWakeup.runId, createdRun.id));
    const scheduled = wakeups.find((w) => w.notBefore !== null)!;
    const claim = await testApp.app.get(RunWakeupClaimService).claim({
      wakeupId: scheduled.id,
      runId: createdRun.id,
      action: 'resume',
      sourceState: 'PAUSED_QUOTA',
      expectedRevision: scheduled.expectedRevision,
    });
    expect(claim).toEqual({ claimed: false, reason: 'stale_revision' });
  });

  it('stores the finished clips as one video list artifact, in order', async () => {
    const createdRun = await setupRun();
    const execution = createdRun.stageExecutions.find((e) => e.stageKey === 'flow')!;
    const dir = await files;
    const clip = async (name: string) => {
      const localPath = join(dir, name);
      await writeFile(localPath, `video ${name}`);
      return { role: 'download', localPath, mime: 'video/mp4', filename: name };
    };
    fetched = {
      output: {
        status: 'completed',
        resetAt: '',
        clips: [
          { index: 2, label: 'Second', prompt: 'p2', filename: '002.mp4' },
          { index: 1, label: 'First', prompt: 'p1', filename: '001.mp4' },
        ],
      },
      attachments: [
        await clip('001.mp4'),
        await clip('002.mp4'),
        {
          role: 'evidence',
          localPath: join(dir, 'final.png'),
          mime: 'image/png',
          filename: 'final.png',
        },
      ],
    };
    await writeFile(join(dir, 'final.png'), 'screenshot');

    const result = await attempt(createdRun.id, execution.id);
    expect(result.outcome).toBe('success');

    const [row] = await testDb.db
      .select()
      .from(artifact)
      .where(and(eq(artifact.runId, createdRun.id), eq(artifact.stale, false)));
    expect(row?.kind).toBe('media.video_list');
    expect(row?.blobId).toBeNull();
    const data = row!.data as { clips: Array<{ index: number; label: string; blobId: string }> };
    expect(data.clips.map((c) => [c.index, c.label])).toEqual([
      [1, 'First'],
      [2, 'Second'],
    ]);
    const attachments = await testDb.db
      .select()
      .from(artifactAttachment)
      .where(eq(artifactAttachment.artifactId, row!.id));
    expect(attachments.filter((a) => a.role === 'clip')).toHaveLength(2);
    expect(attachments.filter((a) => a.role === 'evidence')).toHaveLength(1);

    // The run view exposes the clips in order, without duplicating them as downloads.
    const output = await testApp.app.get(RunService).stageOutput(createdRun.id, 'flow');
    const view = output.items[0]!.artifact;
    expect(view.clips?.map((c) => c.index)).toEqual([1, 2]);
    expect(view.attachments.map((a) => a.role)).toEqual(['evidence']);
  });

  it('judges the clip list with Codex and, when it names bad clips, asks the next attempt to redo only those', async () => {
    const qcStage: StageDef = {
      ...flowStage,
      qc: {
        criteria: 'Same character and studio in every clip',
        threshold: 70,
        model: { provider: 'codex', modelId: 'gpt-example', params: { reasoningEffort: 'low' } },
        includeInputs: false,
      },
    };
    const channel = await testApp.app.get(ChannelService).create('local', {
      name: `Flow QC ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprints = testApp.app.get(BlueprintService);
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Flow QC');
    const dto = {
      graph: [qcStage],
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    };
    // A judge that can't watch video is refused at save time.
    const badJudge = {
      ...dto,
      graph: [
        {
          ...qcStage,
          qc: { ...qcStage.qc!, model: { provider: 'fake', modelId: 'fake-judge-1', params: {} } },
        },
      ],
    };
    expect((await blueprints.validateOnly(blueprintId, badJudge)).issues).toContainEqual(
      expect.objectContaining({ path: 'stages.flow.qc.model', severity: 'error' }),
    );
    const version = await blueprints.createVersion(blueprintId, dto);
    expect(version.runnable).toBe(true);

    const createdRun = await testApp.app.get(RunService).create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });
    await testDb.db
      .update(runTable)
      .set({ state: 'RUNNING' })
      .where(eq(runTable.id, createdRun.id));
    const execution = createdRun.stageExecutions.find((e) => e.stageKey === 'flow')!;
    const dir = await files;
    const clip = async (name: string) => {
      const localPath = join(dir, name);
      await writeFile(localPath, `video ${name}`);
      return { role: 'download', localPath, mime: 'video/mp4', filename: name };
    };
    fetched = {
      output: {
        status: 'completed',
        resetAt: '',
        errorCode: '',
        errorMessage: '',
        clips: [
          { index: 1, label: 'Scene 1', prompt: 'p1', filename: 'q1.mp4' },
          { index: 2, label: 'Scene 2', prompt: 'p2', filename: 'q2.mp4' },
        ],
      },
      attachments: [await clip('q1.mp4'), await clip('q2.mp4')],
    };
    judged = { score: 40, critique: 'Scene 2 has the wrong background.', failedClips: [2] };

    const first = await attempt(createdRun.id, execution.id);
    expect(first.outcome).toBe('qc_failed');
    const judgeCall = [...requests.values()].find((r) => r.modality === 'text') as {
      params?: Record<string, unknown>;
    };
    expect(judgeCall.params).toMatchObject({
      __inspectFiles: true,
      slots: { qcClip1: expect.anything(), qcClip2: expect.anything() },
    });

    // The next attempt's prompt carries the critique and the clips to redo.
    await attempt(createdRun.id, execution.id);
    const attempts = await testDb.db
      .select()
      .from(stageAttempt)
      .where(eq(stageAttempt.stageExecutionId, execution.id));
    const second = attempts.find((a) => a.attemptNo === 2)!;
    expect(second.renderedPrompt).toContain('Scene 2 has the wrong background.');
    expect(second.renderedPrompt).toContain('Clips to make again (their index): 2');
  });
});
