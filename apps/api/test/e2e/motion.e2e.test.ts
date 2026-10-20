import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  MotionSource,
  Timeline,
  motionSourceJsonSchema,
  type Probe,
  type StageDef,
} from '@reelcraft/shared';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { ChannelService } from '../../src/channel/channel.service';
import { RunService } from '../../src/run/run.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { ComputeJobService } from '../../src/storage/compute-job.service';
import { MotionEditorService } from '../../src/run/motion-editor.service';
import { TimelineCheckService } from '../../src/check/timeline-check.service';
import { ArtifactEditService } from '../../src/run/artifact-edit.service';
import { timelinePlanJsonSchema } from '../../src/capability/compose/timeline-plan-schema';
import { artifact, run as runTable } from '../../src/db/schema';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

const VIDEO_PROBE: Probe = {
  container: 'webm',
  durationSec: 3,
  streams: [{ type: 'video', codec: 'vp9', width: 1280, height: 720 }],
};

const base: Pick<StageDef, 'config' | 'slots' | 'context' | 'checks' | 'retryLimit'> = {
  config: {},
  slots: {},
  context: {},
  checks: [],
  retryLimit: 0,
};

const motionStage = (fakeOutput?: unknown): StageDef => ({
  ...base,
  key: 'motion',
  label: 'Write the graphic',
  capability: 'motion.generate',
  instructions: { template: 'An animated title that says Hello.' },
  config: { width: 1280, height: 720, fps: 30, durationSec: 3 },
  slots: { data: { from: 'const', value: { title: 'Hello' } } },
  output: { kind: 'data', schema: motionSourceJsonSchema },
  checks: [{ type: 'builtin', key: 'motion_code', params: {} }],
  model: {
    provider: 'fake',
    modelId: 'fake-text-1',
    ...(fakeOutput !== undefined && { params: { fakeOutput } }),
  },
});

describe('motion graphics: written by a model, rendered, placed on a timeline (e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;
  let clipPath: string;
  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb, {
      mediaProbe: { probe: async () => VIDEO_PROBE, hasAudio: () => false },
    });
    // Rendering needs Chrome, which CI doesn't have: the render job hands back a ready file.
    clipPath = path.join(await mkdtemp(path.join(os.tmpdir(), 'motion-e2e-')), 'motion.webm');
    await writeFile(clipPath, Buffer.from('fake webm'));
    const compute = testApp.app.get(ComputeJobService);
    vi.spyOn(compute, 'spawn').mockResolvedValue({ jobId: 'motion-job', pid: 1 } as never);
    vi.spyOn(compute, 'collect').mockResolvedValue(clipPath);
    vi.spyOn(compute, 'cleanup').mockResolvedValue(undefined);
  });
  afterAll(async () => {
    try {
      await testApp?.close();
    } finally {
      await testDb.teardown();
    }
  });

  let lastRunId = '';
  async function execute(graph: StageDef[]) {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);
    const runner = testApp.app.get(StageRunnerService);
    const channel = await channels.create('local', {
      name: `Motion ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Motion blueprint');
    const version = await blueprints.createVersion(blueprintId, {
      graph,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    expect(
      (version.validation as Array<{ severity: string; message: string }>)
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.message),
    ).toEqual([]);
    const created = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });
    lastRunId = created.id;
    await runs.start(created.id).catch(() => undefined);
    await testDb.db.update(runTable).set({ state: 'RUNNING' }).where(eq(runTable.id, created.id));
    const outcomes: Record<string, { outcome: string; artifactId?: string; message?: string }> = {};
    for (const stage of graph) {
      const execution = created.stageExecutions.find((e) => e.stageKey === stage.key)!;
      const loaded = await runner.loadStageContext(created.id, stage.key);
      const attempt = await runner.beginAttempt({
        runId: created.id,
        stageExecutionId: execution.id,
        stageKey: stage.key,
      });
      const submitted = await runner.reserveAndSubmit(
        loaded.stage,
        attempt,
        loaded.prevStageKey,
        loaded.effective,
      );
      if (submitted.outcome !== 'submitted') throw new Error(`${stage.key}: ${submitted.outcome}`);
      const finished = await runner.fetchAndFinalize(
        loaded.stage,
        attempt,
        submitted.handle,
        loaded.prevStageKey,
        loaded.effective,
      );
      outcomes[stage.key] = {
        outcome: finished.outcome,
        ...(finished.outcome === 'success' && { artifactId: finished.artifactId }),
        message: JSON.stringify(finished),
      };
      if (finished.outcome !== 'success') break;
    }
    return outcomes;
  }

  const readData = async (artifactId: string) =>
    (await testDb.db.select().from(artifact).where(eq(artifact.id, artifactId)).limit(1))[0]!;

  it('writes a graphic, renders it to a transparent clip and places it on a timeline', async () => {
    const outcomes = await execute([
      motionStage(),
      {
        ...base,
        key: 'clip',
        label: 'Render the graphic',
        capability: 'motion.render',
        slots: { source: { from: 'prev' } },
        output: { kind: 'media.video' },
      },
      {
        ...base,
        key: 'plan',
        label: 'Plan',
        capability: 'text.generate',
        output: { kind: 'data', schema: timelinePlanJsonSchema() },
        model: {
          provider: 'fake',
          modelId: 'fake-text-1',
          params: {
            fakeOutput: {
              version: 1,
              background: '#203040',
              layers: [
                { kind: 'video', asset: 'graphic', atSec: 0, x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
              ],
            },
          },
        },
      },
      {
        ...base,
        key: 'compose',
        label: 'Compose',
        capability: 'timeline.compose',
        config: { inputs: ['graphic'] },
        slots: {
          plan: { from: 'prev' },
          graphic: { from: 'stage', stageKey: 'clip' },
        },
        output: { kind: 'timeline' },
      },
    ]);
    expect(
      Object.values(outcomes).map((o) => (o.outcome === 'success' ? o.outcome : o.message)),
    ).toEqual(['success', 'success', 'success', 'success']);

    const source = MotionSource.parse((await readData(outcomes.motion!.artifactId!)).data);
    expect(source).toMatchObject({
      width: 1280,
      height: 720,
      fps: 30,
      durationSec: 3,
      background: 'transparent',
      props: { title: 'Hello' },
    });
    expect(source.code).toContain('useCurrentFrame');

    const compute = testApp.app.get(ComputeJobService);
    const spec = vi.mocked(compute.spawn).mock.calls.at(-1)![1];
    expect(spec.args).toContain('motion');
    expect(spec.outputFilename).toBe('motion.webm');
    expect(MotionSource.parse(JSON.parse(spec.files![0]!.contents)).code).toBe(source.code);

    const clip = await readData(outcomes.clip!.artifactId!);
    expect(clip.kind).toBe('media.video');

    const timeline = Timeline.parse((await readData(outcomes.compose!.artifactId!)).data);
    const placed = timeline.tracks.flatMap((t) => t.items).find((i) => i.type === 'media');
    expect(placed).toMatchObject({ handle: `artifact:${clip.id}`, x: 192, y: 108, w: 960, h: 540 });
  });

  it('lets a person check, edit and save the code, and runs the clip again', async () => {
    const outcomes = await execute([
      motionStage(),
      {
        ...base,
        key: 'clip',
        label: 'Render the graphic',
        capability: 'motion.render',
        slots: { source: { from: 'prev' } },
        output: { kind: 'media.video' },
      },
    ]);
    expect(outcomes.clip!.outcome).toBe('success');
    const runId = lastRunId;
    await testDb.db.update(runTable).set({ state: 'COMPLETED' }).where(eq(runTable.id, runId));

    const editor = testApp.app.get(MotionEditorService);
    expect(
      (await editor.check(runId, 'motion', 'export default () => Date.now();')).issues,
    ).toHaveLength(1);
    await expect(editor.check(runId, 'clip', 'x')).rejects.toThrow(/not a motion graphic stage/);

    const original = MotionSource.parse((await readData(outcomes.motion!.artifactId!)).data);
    const edited = {
      ...original,
      code: original.code.replace("title = 'Motion'", "title = 'Edited'"),
      durationSec: 2,
    };
    expect((await editor.check(runId, 'motion', edited.code)).issues).toEqual([]);

    const edits = testApp.app.get(ArtifactEditService);
    const preview = (await edits.edit(runId, 'motion', { value: edited })) as {
      previewToken: string;
      affectedStageKeys: string[];
    };
    expect(preview.affectedStageKeys).toContain('clip');
    await edits.edit(runId, 'motion', { value: edited, previewToken: preview.previewToken });

    const rows = await testDb.db
      .select()
      .from(artifact)
      .where(and(eq(artifact.runId, runId), eq(artifact.producerStageKey, 'motion')));
    expect(rows.find((row) => row.id === outcomes.motion!.artifactId)!.stale).toBe(true);
    const saved = rows.find((row) => !row.stale)!;
    expect(saved.userAuthored).toBe(true);
    expect(MotionSource.parse(saved.data)).toMatchObject({ durationSec: 2 });
    expect(MotionSource.parse(saved.data).code).toContain("title = 'Edited'");
  });

  it('embeds a written graphic straight into a composed timeline, with no clip', async () => {
    const outcomes = await execute([
      motionStage(),
      {
        ...base,
        key: 'plan',
        label: 'Plan',
        capability: 'text.generate',
        output: { kind: 'data', schema: timelinePlanJsonSchema() },
        model: {
          provider: 'fake',
          modelId: 'fake-text-1',
          params: {
            fakeOutput: {
              version: 1,
              background: '#203040',
              layers: [{ kind: 'motion', asset: 'graphic', x: 0, y: 0, w: 0.5, h: 0.5, atSec: 0 }],
            },
          },
        },
      },
      {
        ...base,
        key: 'compose',
        label: 'Compose',
        capability: 'timeline.compose',
        config: { inputs: ['graphic'] },
        slots: {
          plan: { from: 'prev' },
          graphic: { from: 'stage', stageKey: 'motion' },
        },
        output: { kind: 'timeline' },
      },
    ]);
    expect(outcomes.compose!.outcome).toBe('success');
    const timeline = Timeline.parse((await readData(outcomes.compose!.artifactId!)).data);
    const item = timeline.tracks.flatMap((t) => t.items).find((i) => i.type === 'motion');
    expect(item).toMatchObject({
      type: 'motion',
      width: 1280,
      height: 720,
      durationSec: 3,
      props: { title: 'Hello' },
      x: 0,
      y: 0,
      w: 960,
      h: 540,
    });
    expect(item?.type === 'motion' && item.code).toContain('useCurrentFrame');
    const checks = await testApp.app.get(TimelineCheckService).run({ runId: lastRunId, timeline });
    expect(checks.find((c) => c.name === 'timeline.motion_code')).toMatchObject({ pass: true });
  });

  it('sends back code that breaks the rules, naming every problem', async () => {
    const outcomes = await execute([
      motionStage({
        status: 'ok',
        message: '',
        result: {
          code: "import fs from 'fs';\nexport default () => <div>{String(fs)}{Math.random()}</div>;",
          durationSec: 3,
          notes: '',
        },
      }),
    ]);
    expect(outcomes.motion!.outcome).not.toBe('success');
    expect(outcomes.motion!.message).toContain('fs');
    expect(outcomes.motion!.message).toContain('random(seed)');
  });
});
