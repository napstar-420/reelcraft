import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Probe, StageDef } from '@reelcraft/shared';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { ChannelService } from '../../src/channel/channel.service';
import { RunService } from '../../src/run/run.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { runStageAttemptLoop } from '../../src/orchestration/functions/stage-attempt-loop';
import { TimelineResourceResolverService } from '../../src/artifact/timeline-resource-resolver.service';
import { ProviderRegistry } from '../../src/provider/provider.registry';
import { QcRunner, type QcOutcome } from '../../src/qc/qc-runner.service';
import {
  artifact,
  artifactAttachment,
  blob,
  ledgerEntry,
  storageOrphan,
  run as runTable,
  stageAttempt,
  stageEvent,
  stageExecution,
} from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

const IMAGE_PROBE: Probe = {
  container: 'png_pipe',
  durationSec: 0,
  streams: [{ type: 'video', codec: 'png', width: 1, height: 1, fps: 1 }],
};

function imageStage(
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
    output: { kind: 'media.image_list' },
    checks: [],
    retryLimit: 0,
    model: { provider: 'fake', modelId: 'fake-image-1', params: params ?? {} },
    ...rest,
  };
}

/**
 * One Generate Image run that makes several images from a single prompt:
 * stored as one ordered list, short-handed provider results, judged as a
 * whole set by quality control, and bound into a later stage's list slot.
 */
describe('Generate Image makes an image list (e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;

  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb, {
      mediaProbe: {
        probe: async () => IMAGE_PROBE,
        hasAudio: () => false,
      },
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
      name: `Image list ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprints = testApp.app.get(BlueprintService);
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Image list');
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

  /** A stage's attempt loop with plain steps, as `stage.execute` runs it. */
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

  type StoredImages = Array<{
    index: number;
    label: string | null;
    filename: string;
    blobId: string;
    probe: Probe;
  }>;

  it('stores one ordered image list from one run and links every image blob', async () => {
    const { runId, executionIds } = await startRun([imageStage('img', { config: { count: 3 } })]);

    const outcome = await runLoop(runId, executionIds[0]!, 'img');
    expect(outcome).toMatchObject({ outcome: 'passed' });

    const [list, ...others] = await currentArtifacts(runId, 'img');
    expect(others).toHaveLength(0);
    expect(list).toMatchObject({ kind: 'media.image_list', blobId: null });
    const images = (list!.data as { images: StoredImages }).images;
    expect(images.map((image) => image.index)).toEqual([0, 1, 2]);
    expect(images.map((image) => image.label)).toEqual(['Image 1', 'Image 2', 'Image 3']);
    expect(images.map((image) => image.filename)).toEqual([
      'fixture.png',
      'fixture-2.png',
      'fixture-3.png',
    ]);
    expect(images.every((image) => image.probe.streams[0]?.width === 1)).toBe(true);

    const blobs = await testDb.db.select().from(blob).where(eq(blob.runId, runId));
    expect(blobs.map((row) => row.id).sort()).toEqual(images.map((image) => image.blobId).sort());
    expect(blobs.every((row) => row.mime === 'image/png')).toBe(true);

    const links = await testDb.db
      .select()
      .from(artifactAttachment)
      .where(eq(artifactAttachment.artifactId, list!.id));
    expect(links.map((link) => link.role)).toEqual(['clip', 'clip', 'clip']);
    expect(links.map((link) => link.blobId).sort()).toEqual(blobs.map((row) => row.id).sort());

    const [execution] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, executionIds[0]!));
    expect(execution).toMatchObject({ state: 'passed', outputArtifactId: list!.id });
  });

  it('resolves one image of the list for a timeline, by its place in the list', async () => {
    const { runId, executionIds } = await startRun([imageStage('img', { config: { count: 3 } })]);
    await runLoop(runId, executionIds[0]!, 'img');
    const [list] = await currentArtifacts(runId, 'img');
    const images = (list!.data as { images: StoredImages }).images;
    const [second] = await testDb.db.select().from(blob).where(eq(blob.id, images[1]!.blobId));
    const handle = `artifact:${list!.id}#1`;
    const timeline = {
      version: 1,
      canvas: { width: 1080, height: 1920, fps: 30, background: '#000000' },
      tracks: [
        {
          id: 'v',
          type: 'video',
          items: [
            { type: 'media', handle, startSec: 0, durationSec: 2, fit: 'cover', overflow: 'trim' },
            {
              type: 'media',
              handle: `artifact:${list!.id}#9`,
              startSec: 2,
              durationSec: 2,
              fit: 'cover',
              overflow: 'trim',
            },
          ],
        },
      ],
    };

    const resolved = await testApp.app
      .get(TimelineResourceResolverService)
      .resolve(runId, timeline);

    expect(resolved[handle]).toMatchObject({
      handle,
      kind: 'media.image',
      sourceKey: second!.objectKey,
    });
    // A place past the end of the list does not resolve.
    expect(resolved[`artifact:${list!.id}#9`]).toBeUndefined();
  });

  it("queues every image's file for deletion with the channel", async () => {
    const { channelId, runId, executionIds } = await startRun([
      imageStage('img', { config: { count: 3 } }),
    ]);
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

  it('keeps the images that came back and notes the shortfall when onShortfall is warn', async () => {
    const { runId, executionIds } = await startRun([
      imageStage('img', { config: { count: 4 }, params: { fakeImageCount: 2 } }),
    ]);

    await expect(runLoop(runId, executionIds[0]!, 'img')).resolves.toMatchObject({
      outcome: 'passed',
    });

    const [list] = await currentArtifacts(runId, 'img');
    expect((list!.data as { images: StoredImages }).images).toHaveLength(2);
    const events = await testDb.db.select().from(stageEvent).where(eq(stageEvent.runId, runId));
    const completed = events.find((event) => event.type === 'job.completed');
    expect(completed?.data).toMatchObject({
      provider: {
        shortfall: { requested: 4, returned: 2 },
        warning: 'The provider returned 2 of 4 images',
      },
    });
  });

  it('settles the cost, then retries like a crash, when onShortfall is fail', async () => {
    const { runId, executionIds } = await startRun([
      imageStage('img', {
        config: { count: 3, onShortfall: 'fail' },
        params: { fakeImageCount: 2, fakeCostUsd: 0.2 },
      }),
    ]);

    const outcome = await runLoop(runId, executionIds[0]!, 'img', 1);

    expect(outcome).toEqual({
      outcome: 'failed',
      reason: 'The provider returned 2 of 3 images',
    });
    const attempts = await attemptsOf(executionIds[0]!);
    expect(attempts).toHaveLength(2);
    for (const attempt of attempts) {
      expect(attempt).toMatchObject({
        outcome: 'provider_error',
        phase: 'settled',
        reviewNote: 'The provider returned 2 of 3 images',
      });
      expect(Number(attempt.costUsd)).toBeCloseTo(0.2);
    }
    // Both calls were billed: each reservation settled at its true cost.
    const actuals = await testDb.db
      .select()
      .from(ledgerEntry)
      .where(and(eq(ledgerEntry.runId, runId), eq(ledgerEntry.kind, 'actual')));
    expect(actuals).toHaveLength(2);
    expect(actuals.reduce((sum, entry) => sum + Number(entry.amountUsd), 0)).toBeCloseTo(0.4);
    // Nothing was stored, and the stage failed once its retries ran out.
    expect(await currentArtifacts(runId, 'img')).toHaveLength(0);
    const [execution] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, executionIds[0]!));
    expect(execution?.state).toBe('failed');
  });

  it('succeeds on a retry when the next attempt returns every image', async () => {
    const { runId, executionIds } = await startRun([
      imageStage('img', {
        config: { count: 3, onShortfall: 'fail' },
        params: { fakeImageCount: 2 },
      }),
    ]);
    // The first attempt is short; the provider makes every image the second time.
    const fake = testApp.app.get(ProviderRegistry).get('fake');
    const submit = fake.submit.bind(fake);
    let submits = 0;
    vi.spyOn(fake, 'submit').mockImplementation((request, key) => {
      submits += 1;
      return submit(
        submits === 1
          ? request
          : { ...request, params: { ...request.params, fakeImageCount: undefined } },
        key,
      );
    });

    await expect(runLoop(runId, executionIds[0]!, 'img', 1)).resolves.toMatchObject({
      outcome: 'passed',
    });

    const attempts = await attemptsOf(executionIds[0]!);
    expect(attempts.map((attempt) => attempt.outcome)).toEqual(['provider_error', 'success']);
    const [list] = await currentArtifacts(runId, 'img');
    expect((list!.data as { images: StoredImages }).images).toHaveLength(3);
  });

  describe('quality control', () => {
    const judged = (overrides: Partial<StageDef> = {}) =>
      imageStage('img', {
        config: { count: 3 },
        qc: {
          criteria: 'One consistent look across the set',
          threshold: 70,
          includeInputs: false,
          maxAttempts: 3,
          model: { provider: 'codex', modelId: 'gpt-example', params: {} },
        },
        ...overrides,
      });
    const rejected: QcOutcome = {
      status: 'failed',
      verdict: { score: 30, critique: 'Image 2 is off style', dimensions: [] },
      costUsd: 0,
    };
    const accepted: QcOutcome = {
      status: 'passed',
      verdict: { score: 90, critique: 'consistent', dimensions: [] },
      costUsd: 0,
    };

    it('shows the judge every image together and makes the whole set again when it is rejected', async () => {
      const { runId, executionIds } = await startRun([judged()]);
      const judge = vi
        .spyOn(testApp.app.get(QcRunner), 'run')
        .mockResolvedValueOnce(rejected)
        .mockResolvedValueOnce(accepted);

      await expect(runLoop(runId, executionIds[0]!, 'img')).resolves.toMatchObject({
        outcome: 'passed',
      });

      expect(judge).toHaveBeenCalledTimes(2);
      for (const [call] of judge.mock.calls) {
        expect(call.envelope.artifact.kind).toBe('media.image_list');
        expect(call.envelope.clips).toBeUndefined();
        expect(call.envelope.images).toHaveLength(3);
        expect(call.envelope.images?.map((image) => image.mime)).toEqual([
          'image/png',
          'image/png',
          'image/png',
        ]);
        expect(call.envelope.images?.map((image) => image.label)).toEqual([
          'Image 1',
          'Image 2',
          'Image 3',
        ]);
      }
      const attempts = await attemptsOf(executionIds[0]!);
      expect(attempts.map((attempt) => attempt.outcome)).toEqual(['qc_failed', 'success']);
      // The rejected set was replaced as a whole: one current list, all of its images new.
      const current = await currentArtifacts(runId, 'img');
      expect(current).toHaveLength(1);
      expect((current[0]!.data as { images: StoredImages }).images).toHaveLength(3);
      const all = await testDb.db.select().from(artifact).where(eq(artifact.runId, runId));
      expect(all.filter((row) => row.stale)).toHaveLength(1);
    });

    it('fails the stage when every set is rejected', async () => {
      const { runId, executionIds } = await startRun([
        judged({
          qc: {
            criteria: 'One consistent look across the set',
            threshold: 70,
            includeInputs: false,
            maxAttempts: 2,
            model: { provider: 'codex', modelId: 'gpt-example', params: {} },
          },
        }),
      ]);
      vi.spyOn(testApp.app.get(QcRunner), 'run').mockResolvedValue(rejected);

      const outcome = await runLoop(runId, executionIds[0]!, 'img');

      expect(outcome).toMatchObject({ outcome: 'failed' });
      expect((outcome as { reason: string }).reason).toContain('qc_failed after 2 attempts');
      expect(await currentArtifacts(runId, 'img')).toHaveLength(0);
    });
  });

  it('binds the list into a later stage as an ordered list of images', async () => {
    const { runId, executionIds } = await startRun([
      imageStage('img', { config: { count: 2 } }),
      imageStage('next', {
        config: {},
        output: { kind: 'media.image' },
        slots: { references: { from: 'prev' } },
      }),
    ]);

    await expect(runLoop(runId, executionIds[0]!, 'img')).resolves.toMatchObject({
      outcome: 'passed',
    });
    await expect(runLoop(runId, executionIds[1]!, 'next')).resolves.toMatchObject({
      outcome: 'passed',
    });

    const [list] = await currentArtifacts(runId, 'img');
    const [second] = await attemptsOf(executionIds[1]!);
    const provenance = JSON.stringify(second?.resolvedInputs);
    expect(provenance).toContain(list!.id);
    expect(provenance).toContain('"clipCount":2');
  });

  describe('when a blueprint is saved', () => {
    it('accepts an image list into a many-slot and refuses it into a one-slot', async () => {
      const { version: ok } = await createVersion([
        imageStage('img', { config: { count: 2 } }),
        imageStage('next', {
          config: {},
          output: { kind: 'media.image' },
          slots: { references: { from: 'prev' } },
        }),
      ]);
      expect(ok.runnable).toBe(true);

      const { version: oneSlot } = await createVersion([
        imageStage('img', { config: { count: 2 } }),
        {
          key: 'clip',
          label: 'clip',
          capability: 'video.generate',
          instructions: { template: 'Pan across the fox' },
          config: {},
          slots: { startFrame: { from: 'prev' } },
          context: {},
          output: { kind: 'media.video' },
          checks: [],
          retryLimit: 0,
          model: { provider: 'fake', modelId: 'fake-video-1', params: {} },
        },
      ]);
      expect(oneSlot.runnable).toBe(false);
    });

    it('refuses a count on a single image, a missing count on a list, and iterate on a list', async () => {
      const bad = async (stage: StageDef) => (await createVersion([stage])).version.runnable;
      expect(
        await bad(imageStage('img', { config: { count: 3 }, output: { kind: 'media.image' } })),
      ).toBe(false);
      expect(await bad(imageStage('img', { config: {} }))).toBe(false);
      expect(await bad(imageStage('img', { config: { count: 9 } }))).toBe(false);
      expect(
        await bad(
          imageStage('img', {
            config: { count: 3 },
            iterate: {
              over: { from: 'const', value: ['a', 'b'] },
              itemAlias: 'x',
              itemRetryLimit: 0,
            },
          }),
        ),
      ).toBe(false);
      expect(await bad(imageStage('img', { config: { count: 3 }, writes: { all: '$' } }))).toBe(
        false,
      );
      // A single image is unchanged.
      expect(await bad(imageStage('img', { config: {}, output: { kind: 'media.image' } }))).toBe(
        true,
      );
    });

    it('needs a judge that can look at images and take that many at once', async () => {
      const withJudge = (model: { provider: string; modelId: string }, count: number) =>
        imageStage('img', {
          config: { count },
          qc: {
            criteria: 'consistent',
            threshold: 70,
            includeInputs: false,
            model: { ...model, params: {} },
          },
        });
      // The fake text judge accepts no image input.
      expect(
        (await createVersion([withJudge({ provider: 'fake', modelId: 'fake-text-1' }, 3)])).version
          .runnable,
      ).toBe(false);
      // Codex opens the files itself.
      expect(
        (await createVersion([withJudge({ provider: 'codex', modelId: 'gpt-example' }, 8)])).version
          .runnable,
      ).toBe(true);
    });
  });
});
