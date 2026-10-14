import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Timeline, type Probe, type StageDef } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { WhiteboardAssetRegistry } from '../../src/capability/whiteboard/asset.registry';
import { drawingsJsonSchema } from '../../src/capability/whiteboard/drawing-prompt';
import { vectorAssetSetJsonSchema } from '../../src/capability/whiteboard/drawing-prepare';
import { sceneSpecJsonSchema } from '../../src/capability/whiteboard/scene-spec-schema';
import { artifact, run as runTable } from '../../src/db/schema';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

const AUDIO_PROBE: Probe = {
  container: 'wav',
  durationSec: 6,
  streams: [{ type: 'audio', codec: 'pcm_u8', sampleRate: 8000, channels: 1 }],
};

const SCRIPT = 'First comes the cue. Then the reward.';

const PLAN = {
  version: 1,
  title: 'Habit loop',
  assetNeeds: [
    {
      id: 'morning-mug',
      label: 'A steaming mug',
      description: 'A mug with steam',
      fallbackId: 'coffee-mug',
    },
    { id: 'gold-cup', label: 'A gold cup', description: 'A trophy', fallbackId: 'trophy' },
  ],
  scenes: [
    {
      id: 'loop',
      template: 'before_after',
      narration: SCRIPT,
      slots: [
        { slot: 'before', asset: 'morning-mug', text: 'Cue', cue: 'first comes the cue' },
        { slot: 'after', asset: 'gold-cup', text: 'Reward', cue: 'then the reward' },
      ],
    },
  ],
};

// The model drew one of the two pictures well, and one badly (a path far off the grid).
const DRAWN = {
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
};

const base = { config: {}, slots: {}, context: {}, checks: [], retryLimit: 0 } as const;

const GRAPH: StageDef[] = [
  {
    ...base,
    key: 'plan',
    label: 'Plan',
    capability: 'text.generate',
    output: { kind: 'data', schema: sceneSpecJsonSchema(new WhiteboardAssetRegistry()) },
    model: { provider: 'fake', modelId: 'fake-text-1', params: { fakeOutput: PLAN } },
  },
  {
    ...base,
    key: 'draw',
    label: 'Draw',
    capability: 'text.generate',
    output: { kind: 'data', schema: drawingsJsonSchema() },
    model: { provider: 'fake', modelId: 'fake-text-1', params: { fakeOutput: DRAWN } },
  },
  {
    ...base,
    key: 'prepare',
    label: 'Prepare',
    capability: 'svg.prepare',
    slots: {
      drawings: { from: 'stage', stageKey: 'draw', path: 'drawings' },
      scenes: { from: 'stage', stageKey: 'plan' },
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
    key: 'compile',
    label: 'Compile',
    capability: 'scene.compile',
    slots: {
      scenes: { from: 'stage', stageKey: 'plan' },
      assets: { from: 'stage', stageKey: 'prepare' },
      voice: { from: 'stage', stageKey: 'voice' },
      timing: { from: 'memory', key: 'timing' },
    },
    output: { kind: 'timeline' },
  },
];

describe('per-run drawings through the real runner (e2e)', () => {
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

  it('draws, prepares, and places a drawing the run made, with a built-in one where it could not', async () => {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);
    const runner = testApp.app.get(StageRunnerService);
    const channel = await channels.create('local', { name: 'Drawings', theme: {}, defaults: {} });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Drawings blueprint');
    const version = await blueprints.createVersion(blueprintId, {
      graph: GRAPH,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    expect(version.validation.filter((issue) => issue.severity === 'error')).toEqual([]);
    const created = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });
    await testDb.db.update(runTable).set({ state: 'RUNNING' }).where(eq(runTable.id, created.id));

    const artifacts: Record<string, string> = {};
    for (const stageKey of GRAPH.map((stage) => stage.key)) {
      const execution = created.stageExecutions.find(
        (candidate) => candidate.stageKey === stageKey,
      )!;
      const { stage, effective, prevStageKey } = await runner.loadStageContext(
        created.id,
        stageKey,
      );
      const attempt = await runner.beginAttempt({
        runId: created.id,
        stageExecutionId: execution.id,
        stageKey,
      });
      const submitted = await runner.reserveAndSubmit(stage, attempt, prevStageKey, effective);
      if (submitted.outcome !== 'submitted')
        throw new Error(`${stageKey} submission: ${submitted.outcome}`);
      const finished = await runner.fetchAndFinalize(
        stage,
        attempt,
        submitted.handle,
        prevStageKey,
        effective,
      );
      expect(finished.outcome, stageKey).toBe('success');
      if (finished.outcome === 'success') artifacts[stageKey] = finished.artifactId;
    }

    const read = async (key: string) =>
      (
        await testDb.db.select().from(artifact).where(eq(artifact.id, artifacts[key]!)).limit(1)
      )[0]!;

    // Only the drawing that could be drawn is in the set.
    const set = (await read('prepare')).data as {
      assets: Array<{ id: string; source: string; label: string }>;
    };
    expect(set.assets).toHaveLength(1);
    expect(set.assets[0]).toMatchObject({
      id: 'morning-mug',
      source: 'generated',
      label: 'A steaming mug',
    });

    // The video places the run's own drawing, and falls back to the built-in cup for the other.
    const timeline = Timeline.parse((await read('compile')).data);
    const items = timeline.tracks.find((track) => track.id === 'drawings')!.items;
    const mug = items.find((item) => item.type === 'sketch' && item.id === 'loop:before:asset');
    const cup = items.find((item) => item.type === 'sketch' && item.id === 'loop:after:asset');
    expect(JSON.stringify(mug)).toContain('M 25 40 L 25 80 L 65 80 L 65 40 Z');
    expect(JSON.stringify(cup)).not.toContain('900');
    expect(cup).toMatchObject({ content: { kind: 'paths' } });
  });
});
