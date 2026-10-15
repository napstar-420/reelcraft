import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Timeline, type Probe, type StageDef } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { AssetService } from '../../src/channel/asset.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { STORAGE_ADAPTER, type StorageAdapter } from '../../src/storage/storage.adapter';
import { TimelineCheckService } from '../../src/check/timeline-check.service';
import { drawingsJsonSchema } from '../../src/capability/vector/drawing-prompt';
import { vectorAssetSetJsonSchema } from '../../src/capability/vector/drawing-prepare';
import { timelinePlanJsonSchema } from '../../src/capability/compose/timeline-plan-schema';
import { artifact, run as runTable } from '../../src/db/schema';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

const AUDIO_PROBE: Probe = {
  container: 'wav',
  durationSec: 6,
  streams: [{ type: 'audio', codec: 'pcm_u8', sampleRate: 8000 }],
};

const SCRIPT = 'First comes the cue. Then the reward.';
const base = { config: {}, slots: {}, context: {}, checks: [], retryLimit: 0 } as const;

const planStage = (plan: unknown): StageDef => ({
  ...base,
  key: 'plan',
  label: 'Plan',
  capability: 'text.generate',
  output: { kind: 'data', schema: timelinePlanJsonSchema() },
  model: { provider: 'fake', modelId: 'fake-text-1', params: { fakeOutput: plan } },
});

/** Runs the stages of a blueprint in order through the real runner, and gives each one's result. */
async function runGraph(testApp: TestApp, testDb: TestDb, graph: StageDef[]) {
  const channels = testApp.app.get(ChannelService);
  const blueprints = testApp.app.get(BlueprintService);
  const runs = testApp.app.get(RunService);
  const runner = testApp.app.get(StageRunnerService);
  const channel = await channels.create('local', {
    name: `Modes ${Date.now()}-${Math.random()}`,
    theme: {},
    defaults: {},
  });
  const prepare = async (library?: (channelId: string) => Promise<void>) => {
    await library?.(channel.id);
  };
  return { channel, prepare, runs, blueprints, runner, graph, testDb };
}

async function execute(ctx: Awaited<ReturnType<typeof runGraph>>, options: { stop?: string } = {}) {
  const blueprintId = await ctx.blueprints.ensureBlueprint(ctx.channel.id, 'Modes blueprint');
  const version = await ctx.blueprints.createVersion(blueprintId, {
    graph: ctx.graph,
    inputs: [],
    roles: [],
    defaults: {},
    budget: { runCapUsd: 10 },
  });
  expect(version.validation.filter((issue) => issue.severity === 'error')).toEqual([]);
  const created = await ctx.runs.create({
    channelId: ctx.channel.id,
    blueprintVersionId: version.id,
    inputs: {},
    roleBindings: {},
    rerunStageKeys: [],
    budgetCapUsd: 10,
  });
  // Starting the run snapshots the library, as in real use.
  await ctx.runs.start(created.id).catch(() => undefined);
  await ctx.testDb.db.update(runTable).set({ state: 'RUNNING' }).where(eq(runTable.id, created.id));
  const outcomes: Record<string, { outcome: string; artifactId?: string; reason?: string }> = {};
  for (const stage of ctx.graph) {
    const execution = created.stageExecutions.find((e) => e.stageKey === stage.key)!;
    const loaded = await ctx.runner.loadStageContext(created.id, stage.key);
    const attempt = await ctx.runner.beginAttempt({
      runId: created.id,
      stageExecutionId: execution.id,
      stageKey: stage.key,
    });
    const submitted = await ctx.runner.reserveAndSubmit(
      loaded.stage,
      attempt,
      loaded.prevStageKey,
      loaded.effective,
    );
    if (submitted.outcome !== 'submitted') throw new Error(`${stage.key}: ${submitted.outcome}`);
    const finished = await ctx.runner.fetchAndFinalize(
      loaded.stage,
      attempt,
      submitted.handle,
      loaded.prevStageKey,
      loaded.effective,
    );
    outcomes[stage.key] = {
      outcome: finished.outcome,
      ...(finished.outcome === 'success' && { artifactId: finished.artifactId }),
    };
    if (stage.key === options.stop) break;
  }
  return { runId: created.id, outcomes };
}

describe('every asset kind, generated in the run or picked from the library (e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;
  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb, {
      mediaProbe: { probe: async () => AUDIO_PROBE, hasAudio: () => true },
    });
  });
  afterAll(async () => {
    try {
      await testApp?.close();
    } finally {
      await testDb.teardown();
    }
  });

  const readTimeline = async (artifactId: string) =>
    Timeline.parse(
      (await testDb.db.select().from(artifact).where(eq(artifact.id, artifactId)).limit(1))[0]!
        .data,
    );

  it('generated: the run draws, speaks, makes music and a sound, and a plan places them all', async () => {
    const PLAN = {
      version: 1,
      background: '#fbfaf5',
      ducks: [{ track: 'music', under: 'voice' }],
      layers: [
        { kind: 'audio', asset: 'voice', track: 'voice' },
        { kind: 'audio', asset: 'song', track: 'music', loop: true, volume: 0.15 },
        { kind: 'audio', asset: 'ping', track: 'sfx', atCue: 'then the reward', volume: 0.5 },
        {
          kind: 'drawing',
          asset: 'morning-mug',
          x: 0.1,
          y: 0.25,
          w: 0.3,
          h: 0.5,
          atCue: 'first comes the cue',
        },
        {
          kind: 'drawing',
          asset: 'gold-cup',
          x: 0.6,
          y: 0.25,
          w: 0.3,
          h: 0.5,
          atCue: 'then the reward',
        },
        {
          kind: 'text',
          text: 'Cue, then reward',
          x: 0.1,
          y: 0.05,
          w: 0.8,
          h: 0.15,
          anim: 'handwrite',
        },
        { kind: 'captions' },
      ],
    };
    const graph: StageDef[] = [
      {
        ...base,
        key: 'draw',
        label: 'Draw',
        capability: 'text.generate',
        output: { kind: 'data', schema: drawingsJsonSchema() },
        model: {
          provider: 'fake',
          modelId: 'fake-text-1',
          params: {
            // One drawing is good, the other is far off the grid and can't be used.
            fakeOutput: {
              drawings: [
                {
                  id: 'morning-mug',
                  strokes: [
                    { d: 'M 25 40 L 25 80 L 65 80 L 65 40 Z', weight: 'bold' },
                    { d: 'M 65 50 C 85 50 85 70 65 70', color: 'accent1' },
                  ],
                },
                { id: 'gold-cup', strokes: [{ d: 'M 0 0 L 900 900' }] },
              ],
            },
          },
        },
      },
      {
        ...base,
        key: 'prepare',
        label: 'Prepare',
        capability: 'svg.prepare',
        slots: {
          drawings: { from: 'stage', stageKey: 'draw', path: 'drawings' },
          needs: {
            from: 'const',
            value: [
              { id: 'morning-mug', label: 'A steaming mug', description: 'a mug' },
              { id: 'gold-cup', label: 'A gold cup', description: 'a cup', fallbackId: 'trophy' },
            ],
          },
        },
        output: { kind: 'data', schema: vectorAssetSetJsonSchema() },
      },
      {
        ...base,
        key: 'voice',
        label: 'Voice',
        capability: 'audio.speech',
        slots: { text: { from: 'const', value: SCRIPT } },
        output: { kind: 'media.audio' },
        writes: { timing: 'timing' },
        model: { provider: 'fake', modelId: 'fake-audio-1', params: {} },
      },
      {
        ...base,
        key: 'song',
        label: 'Music',
        capability: 'audio.music',
        config: { durationSec: 4 },
        instructions: { template: 'Calm piano' },
        output: { kind: 'media.audio' },
        model: { provider: 'fake', modelId: 'fake-music-1', params: {} },
      },
      {
        ...base,
        key: 'ping',
        label: 'Ping',
        capability: 'audio.sfx',
        instructions: { template: 'A bright ping' },
        output: { kind: 'media.audio' },
        model: { provider: 'fake', modelId: 'fake-sfx-1', params: {} },
      },
      planStage(PLAN),
      {
        ...base,
        key: 'compose',
        label: 'Compose',
        capability: 'timeline.compose',
        config: { inputs: ['voice', 'song', 'ping'], hand: 'marker' },
        slots: {
          plan: { from: 'stage', stageKey: 'plan' },
          assets: { from: 'stage', stageKey: 'prepare' },
          voice: { from: 'stage', stageKey: 'voice' },
          song: { from: 'stage', stageKey: 'song' },
          ping: { from: 'stage', stageKey: 'ping' },
          timing: { from: 'memory', key: 'timing' },
        },
        output: { kind: 'timeline' },
      },
    ];
    const ctx = await runGraph(testApp, testDb, graph);
    const { runId, outcomes } = await execute(ctx);
    expect(Object.values(outcomes).map((o) => o.outcome)).toEqual(Array(7).fill('success'));

    const timeline = await readTimeline(outcomes.compose!.artifactId!);
    expect(timeline.canvas.background).toBe('#fbfaf5');
    expect(timeline.tracks.map((track) => track.id)).toEqual([
      'overlay',
      'captions',
      'voice',
      'music',
      'sfx',
    ]);
    const drawings = timeline.tracks.find((t) => t.id === 'overlay')!.items;
    const mug = drawings.find((i) => i.type === 'graphic' && i.id === 'layer-4');
    const cup = drawings.find((i) => i.type === 'graphic' && i.id === 'layer-5');
    expect(JSON.stringify(mug)).toContain('M 25 40 L 25 80 L 65 80 L 65 40 Z');
    // The drawing that couldn't be used was replaced by the built-in cup, so the plan still holds.
    expect(JSON.stringify(cup)).not.toContain('900');
    expect(cup).toMatchObject({ content: { kind: 'paths' } });
    expect(timeline.tracks.find((t) => t.id === 'music')!.duckUnder).toBe('voice');
    const ping = timeline.tracks.find((t) => t.id === 'sfx')!.items[0]!;
    expect(ping).toMatchObject({ type: 'media', handle: expect.stringMatching(/^artifact:/) });
    expect((ping as { startSec: number }).startSec).toBeCloseTo(1.6, 1);

    const checks = await testApp.app.get(TimelineCheckService).run({ runId, timeline: timeline });
    expect(checks.find((c) => c.name === 'timeline.handles_resolve')).toMatchObject({ pass: true });
  });

  it('library: a plan picks only from uploaded assets, and built-ins when they are allowed', async () => {
    const assets = testApp.app.get(AssetService);
    const storage = testApp.app.get<StorageAdapter>(STORAGE_ADAPTER);
    const PLAN = {
      version: 1,
      layers: [
        { kind: 'audio', asset: 'rain-loop', track: 'ambience', loop: true, volume: 0.2 },
        { kind: 'audio', asset: 'whoosh', track: 'sfx', atSec: 1 },
        { kind: 'drawing', asset: 'Rocket', x: 0.3, y: 0.2, w: 0.4, h: 0.6, atSec: 0.5 },
      ],
    };
    const everything = (builtin?: false): StageDef => ({
      ...base,
      key: builtin === false ? 'only_uploaded' : 'everything',
      label: 'Compose',
      capability: 'timeline.compose',
      slots: {
        plan: { from: 'stage', stageKey: 'plan' },
        assets: builtin === false ? { from: 'library', builtin: false } : { from: 'library' },
      },
      output: { kind: 'timeline' },
    });
    const ctx = await runGraph(testApp, testDb, [planStage(PLAN), everything(), everything(false)]);
    // Uploaded before the run starts: the run snapshots the library then.
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2 L16 12 L8 12 Z" fill="#e8453c"/><rect x="8" y="12" width="8" height="8" stroke="#222" fill="none"/></svg>';
    const svgUpload = await assets.requestUpload(ctx.channel.id, 'svg');
    await storage.put(svgUpload.objectKey, Buffer.from(svg), { mime: 'image/svg+xml' });
    const rocket = await assets.create(ctx.channel.id, {
      name: 'Rocket',
      kind: 'vector',
      blobId: svgUpload.blobId,
      objectKey: svgUpload.objectKey,
      sha256: 'a',
      tags: ['space'],
    });
    const wavUpload = await assets.requestUpload(ctx.channel.id, 'wav');
    await storage.put(wavUpload.objectKey, Buffer.from('RIFFfakewav'), { mime: 'audio/wav' });
    const rain = await assets.create(ctx.channel.id, {
      name: 'rain-loop',
      kind: 'media.audio',
      blobId: wavUpload.blobId,
      objectKey: wavUpload.objectKey,
      sha256: 'b',
      tags: ['ambient'],
    });
    expect(rocket.kind).toBe('vector');

    const { outcomes } = await execute(ctx);
    expect(outcomes.plan!.outcome).toBe('success');
    // With built-ins allowed, the plan can use the uploaded drawing and sound and a built-in whoosh.
    expect(outcomes.everything!.outcome).toBe('success');
    const timeline = await readTimeline(outcomes.everything!.artifactId!);
    const rain1 = timeline.tracks.find((t) => t.id === 'ambience')!.items[0]!;
    expect(rain1).toMatchObject({ type: 'media', handle: `asset:${rain.id}` });
    expect(timeline.tracks.find((t) => t.id === 'sfx')!.items[0]).toMatchObject({
      handle: 'builtin:audio/whoosh',
    });
    const rocketItem = timeline.tracks.find((t) => t.id === 'overlay')!.items[0]!;
    expect(rocketItem).toMatchObject({ type: 'graphic', content: { kind: 'paths' } });
    expect(JSON.stringify(rocketItem)).toContain('#e8453c');

    // Told to use only what was uploaded, the same plan is refused: the whoosh isn't in the library.
    expect(outcomes.only_uploaded!.outcome).not.toBe('success');
  });

  it('refuses an SVG that cannot be drawn when it is uploaded', async () => {
    const assets = testApp.app.get(AssetService);
    const storage = testApp.app.get<StorageAdapter>(STORAGE_ADAPTER);
    const channel = await testApp.app
      .get(ChannelService)
      .create('local', { name: `Bad svg ${Date.now()}`, theme: {}, defaults: {} });
    const upload = await assets.requestUpload(channel.id, 'svg');
    await storage.put(
      upload.objectKey,
      Buffer.from('<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>'),
      { mime: 'image/svg+xml' },
    );
    await expect(
      assets.create(channel.id, {
        name: 'Bad',
        kind: 'vector',
        blobId: upload.blobId,
        objectKey: upload.objectKey,
        sha256: 'c',
        tags: [],
      }),
    ).rejects.toMatchObject({ response: { code: 'asset_vector_invalid' } });
  });
});
