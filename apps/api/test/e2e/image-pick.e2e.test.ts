import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Probe, StageDef } from '@reelcraft/shared';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { ChannelService } from '../../src/channel/channel.service';
import { RunService } from '../../src/run/run.service';
import { HumanActionService } from '../../src/run/human-action.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { runStageAttemptLoop } from '../../src/orchestration/functions/stage-attempt-loop';
import { CheckRunner } from '../../src/check/check-runner.service';
import { QcRunner, type QcOutcome } from '../../src/qc/qc-runner.service';
import {
  artifact,
  artifactAttachment,
  blob,
  run as runTable,
  stageAttempt,
  stageEvent,
  stageExecution,
  stageItem,
  storageOrphan,
} from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

const IMAGE_PROBE: Probe = {
  container: 'png_pipe',
  durationSec: 0,
  streams: [{ type: 'video', codec: 'png', width: 1, height: 1, fps: 1 }],
};

const JUDGE = { provider: 'codex', modelId: 'gpt-example', params: {} };

function qcDef(overrides: Partial<NonNullable<StageDef['qc']>> = {}): NonNullable<StageDef['qc']> {
  return {
    criteria: 'Sharp, well composed',
    threshold: 70,
    includeInputs: false,
    maxAttempts: 3,
    model: JUDGE,
    ...overrides,
  };
}

/** A Generate Image stage that makes `count` candidates for QC to pick from. */
function pickStage(
  key: string,
  overrides: Partial<StageDef> & { params?: Record<string, unknown> } = {},
): StageDef {
  const { params, ...rest } = overrides;
  return {
    key,
    label: key,
    capability: 'image.generate',
    instructions: { template: 'A red fox in the snow' },
    config: { count: 3 },
    slots: {},
    context: {},
    output: { kind: 'media.image' },
    checks: [],
    retryLimit: 0,
    qc: qcDef(),
    model: { provider: 'fake', modelId: 'fake-image-1', params: params ?? {} },
    ...rest,
  };
}

const picked = (index: number, score = 90): QcOutcome => ({
  status: 'passed',
  verdict: { score, critique: `Image ${index + 1} is the sharpest`, selectedImage: index },
  costUsd: 0,
});
const rejectedAll = (best = 0): QcOutcome => ({
  status: 'failed',
  verdict: { score: 30, critique: 'All soft', selectedImage: best },
  costUsd: 0,
});

type Candidates = Array<{ index: number; label: string | null; blobId: string; probe: Probe }>;

/**
 * Generate Image makes several candidates and quality control picks the
 * best: the stage's output is still one `media.image`.
 */
describe('Generate Image picks the best of several candidates (e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;

  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb, {
      mediaProbe: { probe: async () => IMAGE_PROBE, hasAudio: () => false },
    });
  });

  afterAll(async () => {
    try {
      await testApp?.close();
    } finally {
      await testDb.teardown();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function createVersion(graph: StageDef[]) {
    const channel = await testApp.app.get(ChannelService).create('local', {
      name: `Image pick ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprints = testApp.app.get(BlueprintService);
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Image pick');
    const version = await blueprints.createVersion(blueprintId, {
      graph,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    return { channel, version };
  }

  async function startRun(graph: StageDef[]) {
    const { channel, version } = await createVersion(graph);
    expect(version.runnable).toBe(true);
    const created = await testApp.app.get(RunService).create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });
    await testDb.db.update(runTable).set({ state: 'RUNNING' }).where(eq(runTable.id, created.id));
    return {
      channelId: channel.id,
      runId: created.id,
      executionIds: created.stageExecutions.map((execution) => execution.id),
    };
  }

  async function runLoop(runId: string, executionId: string, stageKey: string, retryLimit = 0) {
    const runner = testApp.app.get(StageRunnerService);
    const { stage, effective, prevStageKey } = await runner.loadStageContext(runId, stageKey);
    return runStageAttemptLoop({
      step: { run: (_id: string, fn: () => unknown) => fn(), sleep: vi.fn() } as never,
      logger: { warn: vi.fn() } as never,
      runner,
      stage,
      effective,
      prevStageKey,
      runId,
      stageExecutionId: executionId,
      stageKey,
      retryLimit,
    });
  }

  const attemptsOf = (executionId: string) =>
    testDb.db
      .select()
      .from(stageAttempt)
      .where(and(eq(stageAttempt.stageExecutionId, executionId), isNull(stageAttempt.stageItemId)))
      .orderBy(stageAttempt.attemptNo);

  const currentArtifacts = (runId: string, stageKey: string) =>
    testDb.db
      .select()
      .from(artifact)
      .where(
        and(
          eq(artifact.runId, runId),
          eq(artifact.producerStageKey, stageKey),
          eq(artifact.stale, false),
        ),
      );

  it('keeps the image quality control chose as the stage output, with the candidates beside it', async () => {
    const { runId, executionIds } = await startRun([pickStage('img')]);
    const judge = vi.spyOn(testApp.app.get(QcRunner), 'run').mockResolvedValue(picked(2));

    await expect(runLoop(runId, executionIds[0]!, 'img')).resolves.toMatchObject({
      outcome: 'passed',
    });

    // The judge saw all three candidates and was asked to choose one.
    const [call] = judge.mock.calls[0]!;
    expect(call.envelope.artifact.kind).toBe('media.image');
    expect(call.envelope.media).toBeUndefined();
    expect(call.envelope.selectBest).toBe(true);
    expect(call.envelope.images?.map((image) => image.label)).toEqual([
      'Image 1',
      'Image 2',
      'Image 3',
    ]);

    // One current artifact: a plain image whose file is the third candidate.
    const [image, ...others] = await currentArtifacts(runId, 'img');
    expect(others).toHaveLength(0);
    expect(image).toMatchObject({ kind: 'media.image' });
    const data = image!.data as { candidates: Candidates; selectedIndex: number };
    expect(data.selectedIndex).toBe(2);
    expect(data.candidates.map((candidate) => candidate.label)).toEqual([
      'Image 1',
      'Image 2',
      'Image 3',
    ]);
    expect(image!.blobId).toBe(data.candidates[2]!.blobId);
    expect(image!.probe).toMatchObject({ streams: [{ width: 1 }] });

    // Every candidate's file is kept and linked, hidden from the attachment list.
    const links = await testDb.db
      .select()
      .from(artifactAttachment)
      .where(eq(artifactAttachment.artifactId, image!.id));
    expect(links.map((link) => link.role)).toEqual(['clip', 'clip', 'clip']);
    const blobs = await testDb.db.select().from(blob).where(eq(blob.runId, runId));
    expect(blobs).toHaveLength(3);

    const events = await testDb.db.select().from(stageEvent).where(eq(stageEvent.runId, runId));
    expect(events.find((event) => event.type === 'qc.pick')?.message).toBe(
      'Quality control chose Image 3 of 3',
    );
    const [execution] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, executionIds[0]!));
    expect(execution).toMatchObject({ state: 'passed', outputArtifactId: image!.id });
  });

  it('feeds the chosen image to a later stage as one image', async () => {
    const clip: StageDef = {
      key: 'clip',
      label: 'clip',
      capability: 'video.generate',
      instructions: { template: 'Pan across the fox' },
      config: {},
      slots: { startFrame: { from: 'prev' } },
      context: {},
      output: { kind: 'media.video', constraints: { audio: 'optional' } },
      checks: [],
      retryLimit: 0,
      model: {
        provider: 'fake',
        modelId: 'fake-video-1',
        params: {
          fakeOutput: { kind: 'media.video', mime: 'video/mp4', filename: 'c.mp4', base64: 'AA==' },
        },
      },
    };
    // A one-image slot accepts a picked image, which a list would not fit.
    const { runId, executionIds } = await startRun([pickStage('img'), clip]);
    vi.spyOn(testApp.app.get(QcRunner), 'run').mockResolvedValue(picked(1));

    await runLoop(runId, executionIds[0]!, 'img');
    await expect(runLoop(runId, executionIds[1]!, 'clip')).resolves.toMatchObject({
      outcome: 'passed',
    });

    const [image] = await currentArtifacts(runId, 'img');
    const [attempt] = await attemptsOf(executionIds[1]!);
    expect(JSON.stringify(attempt?.resolvedInputs)).toContain(image!.id);
  });

  describe('when quality control rejects every candidate', () => {
    it('makes all the candidates again and picks from the new ones', async () => {
      const { runId, executionIds } = await startRun([pickStage('img')]);
      const judge = vi
        .spyOn(testApp.app.get(QcRunner), 'run')
        .mockResolvedValueOnce(rejectedAll())
        .mockResolvedValueOnce(picked(1));

      await expect(runLoop(runId, executionIds[0]!, 'img')).resolves.toMatchObject({
        outcome: 'passed',
      });

      expect(judge).toHaveBeenCalledTimes(2);
      const attempts = await attemptsOf(executionIds[0]!);
      expect(attempts.map((attempt) => attempt.outcome)).toEqual(['qc_failed', 'success']);
      const current = await currentArtifacts(runId, 'img');
      expect(current).toHaveLength(1);
      expect((current[0]!.data as { candidates: Candidates }).candidates).toHaveLength(3);
      const all = await testDb.db.select().from(artifact).where(eq(artifact.runId, runId));
      expect(all.filter((row) => row.stale)).toHaveLength(1);
      // The critique went into the second round's prompt.
      expect(attempts[1]?.renderedPrompt).toContain('All soft');
    });

    it('fails the stage once the attempts are spent', async () => {
      const { runId, executionIds } = await startRun([
        pickStage('img', { qc: qcDef({ maxAttempts: 2 }) }),
      ]);
      vi.spyOn(testApp.app.get(QcRunner), 'run').mockResolvedValue(rejectedAll());

      const outcome = await runLoop(runId, executionIds[0]!, 'img');

      expect(outcome).toMatchObject({ outcome: 'failed' });
      expect((outcome as { reason: string }).reason).toContain('qc_failed after 2 attempts');
      expect(await currentArtifacts(runId, 'img')).toHaveLength(0);
    });

    it('hands the best rejected candidate to a person when onExhausted is human_review', async () => {
      const { runId, executionIds } = await startRun([
        pickStage('img', { qc: qcDef({ maxAttempts: 1, onExhausted: 'human_review' }) }),
      ]);
      vi.spyOn(testApp.app.get(QcRunner), 'run').mockResolvedValue(rejectedAll(1));

      await expect(runLoop(runId, executionIds[0]!, 'img')).resolves.toMatchObject({
        outcome: 'approval_required',
      });

      const [attempt] = await attemptsOf(executionIds[0]!);
      const [held] = await testDb.db
        .select()
        .from(artifact)
        .where(eq(artifact.id, attempt!.artifactId!));
      const data = held!.data as { candidates: Candidates; selectedIndex: number };
      expect(data.selectedIndex).toBe(1);
      expect(held!.blobId).toBe(data.candidates[1]!.blobId);
    });
  });

  describe('checks', () => {
    const fail = { name: 'media_format', kind: 'builtin', pass: false, fault: 'artifact' } as const;
    const pass = { name: 'media_format', kind: 'builtin', pass: true } as const;

    it('judges only the candidates that pass their checks', async () => {
      const { runId, executionIds } = await startRun([
        pickStage('img', { checks: [{ type: 'builtin', key: 'non_empty', params: {} }] }),
      ]);
      vi.spyOn(testApp.app.get(CheckRunner), 'run')
        .mockResolvedValueOnce([fail])
        .mockResolvedValue([pass]);
      const judge = vi.spyOn(testApp.app.get(QcRunner), 'run').mockResolvedValue(picked(2));

      await expect(runLoop(runId, executionIds[0]!, 'img')).resolves.toMatchObject({
        outcome: 'passed',
      });

      const [call] = judge.mock.calls[0]!;
      expect(call.envelope.images?.map((image) => image.index)).toEqual([1, 2]);
      const [image] = await currentArtifacts(runId, 'img');
      expect((image!.data as { selectedIndex: number }).selectedIndex).toBe(2);
      const events = await testDb.db.select().from(stageEvent).where(eq(stageEvent.runId, runId));
      expect(events.find((event) => event.type === 'checks.dropped')?.message).toContain('Image 1');
    });

    it('fails the attempt, and asks nothing of the judge, when no candidate passes', async () => {
      const { runId, executionIds } = await startRun([
        pickStage('img', {
          checks: [{ type: 'builtin', key: 'non_empty', params: {} }],
          checkMaxAttempts: 1,
        }),
      ]);
      vi.spyOn(testApp.app.get(CheckRunner), 'run').mockResolvedValue([fail]);
      const judge = vi.spyOn(testApp.app.get(QcRunner), 'run').mockResolvedValue(picked(0));

      const outcome = await runLoop(runId, executionIds[0]!, 'img');

      expect(outcome).toMatchObject({ outcome: 'failed' });
      expect(judge).not.toHaveBeenCalled();
      const attempts = await attemptsOf(executionIds[0]!);
      expect(attempts.map((attempt) => attempt.outcome)).toEqual(['check_failed']);
    });
  });

  describe('when fewer candidates come back', () => {
    it('picks from the ones that came back when onShortfall is warn', async () => {
      const { runId, executionIds } = await startRun([
        pickStage('img', { config: { count: 4 }, params: { fakeImageCount: 2 } }),
      ]);
      const judge = vi.spyOn(testApp.app.get(QcRunner), 'run').mockResolvedValue(picked(1));

      await expect(runLoop(runId, executionIds[0]!, 'img')).resolves.toMatchObject({
        outcome: 'passed',
      });

      expect(judge.mock.calls[0]![0].envelope.images).toHaveLength(2);
      const [image] = await currentArtifacts(runId, 'img');
      expect((image!.data as { candidates: Candidates }).candidates).toHaveLength(2);
    });

    it('retries like a crash, without asking the judge, when onShortfall is fail', async () => {
      const { runId, executionIds } = await startRun([
        pickStage('img', {
          config: { count: 4, onShortfall: 'fail' },
          params: { fakeImageCount: 2 },
        }),
      ]);
      const judge = vi.spyOn(testApp.app.get(QcRunner), 'run').mockResolvedValue(picked(0));

      const outcome = await runLoop(runId, executionIds[0]!, 'img', 1);

      expect(outcome).toEqual({ outcome: 'failed', reason: 'The provider returned 2 of 4 images' });
      expect(judge).not.toHaveBeenCalled();
      const attempts = await attemptsOf(executionIds[0]!);
      expect(attempts.map((attempt) => attempt.outcome)).toEqual([
        'provider_error',
        'provider_error',
      ]);
    });
  });

  describe('when quality control cannot run', () => {
    it('Retry QC picks again from the stored candidates, without making more', async () => {
      const { runId, executionIds } = await startRun([pickStage('img')]);
      const judge = vi
        .spyOn(testApp.app.get(QcRunner), 'run')
        .mockResolvedValue({ status: 'error', reason: 'judge unreachable', costUsd: 0 });
      await expect(runLoop(runId, executionIds[0]!, 'img')).resolves.toMatchObject({
        outcome: 'approval_required',
      });
      await testDb.db
        .update(runTable)
        .set({ state: 'PAUSED_APPROVAL', cursorStageKey: 'img' })
        .where(eq(runTable.id, runId));
      await testApp.app.get(HumanActionService).retryQc(runId, 'img');

      judge.mockResolvedValue(picked(2));
      await testDb.db.update(runTable).set({ state: 'RUNNING' }).where(eq(runTable.id, runId));
      await expect(runLoop(runId, executionIds[0]!, 'img')).resolves.toMatchObject({
        outcome: 'passed',
      });

      // Still the one generation: three files, one attempt, the pick applied.
      expect(await testDb.db.select().from(blob).where(eq(blob.runId, runId))).toHaveLength(3);
      expect(await attemptsOf(executionIds[0]!)).toHaveLength(1);
      const [call] = judge.mock.calls.at(-1)!;
      expect(call.envelope.images).toHaveLength(3);
      expect(call.envelope.selectBest).toBe(true);
      const [image] = await currentArtifacts(runId, 'img');
      const data = image!.data as { candidates: Candidates; selectedIndex: number };
      expect(data.selectedIndex).toBe(2);
      expect(image!.blobId).toBe(data.candidates[2]!.blobId);
    });
  });

  it('picks per item when the stage iterates', async () => {
    const seed: StageDef = {
      key: 'shots',
      label: 'Shots',
      capability: 'text.generate',
      config: {},
      slots: {},
      context: {},
      output: { kind: 'data', schema: { type: 'array', items: { type: 'string' } } },
      checks: [],
      retryLimit: 0,
      model: {
        provider: 'fake',
        modelId: 'fake-text-1',
        params: { max_tokens: 64, fakeOutput: ['fox', 'owl'] },
      },
    };
    const images = pickStage('images', {
      slots: { shot: { from: 'item' } },
      iterate: { over: { from: 'prev' }, itemAlias: 'shot', itemRetryLimit: 0, maxItems: 5 },
    });
    const { runId, executionIds } = await startRun([seed, images]);
    const runner = testApp.app.get(StageRunnerService);
    await runLoop(runId, executionIds[0]!, 'shots');
    const { stage, effective, prevStageKey } = await runner.loadStageContext(runId, 'images');
    const resolved = await runner.resolveIterateCount(
      runId,
      executionIds[1]!,
      stage,
      effective,
      prevStageKey,
    );
    if (!resolved.ok) throw new Error('expected the stage to resolve its items');
    await runner.ensureStageItems(executionIds[1]!, resolved.itemCount);
    const judge = vi
      .spyOn(testApp.app.get(QcRunner), 'run')
      .mockResolvedValueOnce(picked(0))
      .mockResolvedValueOnce(picked(2));

    for (let itemIndex = 0; itemIndex < resolved.itemCount; itemIndex += 1) {
      const item = await runner.itemState(executionIds[1]!, itemIndex);
      const attempt = await runner.beginAttempt({
        runId,
        stageExecutionId: executionIds[1]!,
        stageKey: 'images',
        itemIndex,
        stageItemId: item.id,
      });
      const submitted = await runner.reserveAndSubmit(stage, attempt, prevStageKey, effective);
      if (submitted.outcome !== 'submitted') throw new Error(submitted.outcome);
      await expect(
        runner.fetchAndFinalize(stage, attempt, submitted.handle, prevStageKey, effective),
      ).resolves.toMatchObject({ outcome: 'success' });
    }

    expect(judge).toHaveBeenCalledTimes(2);
    const items = await testDb.db
      .select()
      .from(stageItem)
      .where(eq(stageItem.stageExecutionId, executionIds[1]!))
      .orderBy(stageItem.itemIndex);
    const artifacts = await testDb.db
      .select()
      .from(artifact)
      .where(
        inArray(
          artifact.id,
          items.map((item) => item.outputArtifactId!),
        ),
      );
    const byId = new Map(artifacts.map((row) => [row.id, row]));
    const chosen = items.map((item) => {
      const row = byId.get(item.outputArtifactId!)!;
      const data = row.data as { candidates: Candidates; selectedIndex: number };
      expect(row.kind).toBe('media.image');
      expect(row.blobId).toBe(data.candidates[data.selectedIndex]!.blobId);
      return data.selectedIndex;
    });
    expect(chosen).toEqual([0, 2]);
  });

  it("queues every candidate's file for deletion with the channel", async () => {
    const { channelId, runId, executionIds } = await startRun([pickStage('img')]);
    vi.spyOn(testApp.app.get(QcRunner), 'run').mockResolvedValue(picked(1));
    await runLoop(runId, executionIds[0]!, 'img');
    const keys = (await testDb.db.select().from(blob).where(eq(blob.runId, runId))).map(
      (row) => row.objectKey,
    );
    expect(keys).toHaveLength(3);
    await testDb.db
      .update(runTable)
      .set({ state: 'CANCELLED', endedAt: new Date().toISOString() })
      .where(eq(runTable.id, runId));

    await testApp.app.get(ChannelService).delete(channelId);

    expect(await testDb.db.select().from(artifact).where(eq(artifact.runId, runId))).toEqual([]);
    const orphans = await testDb.db
      .select({ objectKey: storageOrphan.objectKey })
      .from(storageOrphan)
      .where(inArray(storageOrphan.objectKey, keys));
    expect(orphans.map((row) => row.objectKey).sort()).toEqual([...keys].sort());
  });

  describe('when a blueprint is saved', () => {
    const runnable = async (stage: StageDef) => (await createVersion([stage])).version.runnable;

    it('accepts 2 to 4 candidates with a judge that can see them, and refuses the rest', async () => {
      expect(await runnable(pickStage('img'))).toBe(true);
      expect(await runnable(pickStage('img', { config: { count: 4 } }))).toBe(true);
      expect(await runnable(pickStage('img', { config: { count: 5 } }))).toBe(false);
      // One image is unchanged and needs no QC.
      expect(await runnable(pickStage('img', { config: {}, qc: undefined }))).toBe(true);
    });

    it('refuses candidates without quality control', async () => {
      expect(await runnable(pickStage('img', { qc: undefined }))).toBe(false);
    });

    it('refuses a judge that cannot look at images', async () => {
      const text = qcDef({ model: { provider: 'fake', modelId: 'fake-text-1', params: {} } });
      expect(await runnable(pickStage('img', { qc: text }))).toBe(false);
    });

    it('allows iterate and writes, since the output is a plain image', async () => {
      expect(
        await runnable(
          pickStage('img', {
            iterate: {
              over: { from: 'const', value: ['a', 'b'] },
              itemAlias: 'x',
              itemRetryLimit: 0,
            },
            writes: { all: '$' },
          }),
        ),
      ).toBe(true);
    });
  });
});
