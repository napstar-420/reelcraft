import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Timeline, type Probe, type StageDef } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { WhiteboardAssetRegistry } from '../../src/capability/whiteboard/asset.registry';
import { sceneSpecJsonSchema } from '../../src/capability/whiteboard/scene-spec-schema';
import { TimelineCheckService } from '../../src/check/timeline-check.service';
import { artifact, run as runTable } from '../../src/db/schema';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

const AUDIO_PROBE: Probe = {
  container: 'wav',
  durationSec: 12,
  streams: [{ type: 'audio', codec: 'pcm_u8', sampleRate: 8000 }],
};

const SCRIPT =
  'Habits run your day. First comes the cue. Then the routine. And finally the reward.';

const PLAN = {
  version: 1,
  title: 'How habits work',
  scenes: [
    {
      id: 'intro',
      template: 'title',
      title: 'How habits work',
      narration: 'Habits run your day.',
      slots: [{ slot: 'main', asset: 'brain' }],
    },
    {
      id: 'loop',
      template: 'cause_process_result',
      narration: 'First comes the cue. Then the routine. And finally the reward.',
      slots: [
        { slot: 'cause', asset: 'coffee-mug', text: 'Cue', cue: 'first comes the cue' },
        { slot: 'process', asset: 'person-sitting', text: 'Routine', cue: 'then the routine' },
        { slot: 'result', asset: 'trophy', text: 'Reward', cue: 'and finally the reward' },
      ],
    },
  ],
};

const base = {
  config: {},
  slots: {},
  context: {},
  checks: [],
  retryLimit: 0,
} as const;

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
    label: 'Background music',
    capability: 'audio.music',
    config: { durationSec: 8 },
    instructions: { template: 'Calm, light piano loop for an explainer video' },
    output: { kind: 'media.audio' },
    model: { provider: 'fake', modelId: 'fake-music-1', params: {} },
  },
  {
    ...base,
    key: 'compile',
    label: 'Compile',
    capability: 'scene.compile',
    config: { sfx: true },
    slots: {
      scenes: { from: 'stage', stageKey: 'plan' },
      voice: { from: 'stage', stageKey: 'voice' },
      timing: { from: 'memory', key: 'timing' },
      music: { from: 'stage', stageKey: 'song' },
    },
    output: { kind: 'timeline' },
  },
];

describe('generated music and built-in sound effects (e2e)', () => {
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

  it('generates music, adds sound effects, and the timeline passes its checks', async () => {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);
    const runner = testApp.app.get(StageRunnerService);
    const channel = await channels.create('local', { name: 'Whiteboard', theme: {}, defaults: {} });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Whiteboard audio');
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

    const outcomes: Record<string, string> = {};
    let compiledId: string | undefined;
    for (const stageKey of ['plan', 'voice', 'song', 'compile']) {
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
      outcomes[stageKey] = finished.outcome;
      if (stageKey === 'compile' && finished.outcome === 'success')
        compiledId = finished.artifactId;
    }
    expect(outcomes).toEqual({
      plan: 'success',
      voice: 'success',
      song: 'success',
      compile: 'success',
    });

    const [row] = await testDb.db
      .select()
      .from(artifact)
      .where(eq(artifact.id, compiledId!))
      .limit(1);
    const timeline = Timeline.parse(row!.data);
    expect(timeline.tracks.map((track) => track.id)).toEqual(['voice', 'music', 'sfx', 'drawings']);
    const music = timeline.tracks[1]!;
    expect(music.duckUnder).toBe('voice');
    expect(music.items[0]).toMatchObject({ handle: expect.stringMatching(/^artifact:/) });
    const sounds = timeline.tracks[2]!.items;
    expect(sounds.length).toBeGreaterThan(5);
    expect(sounds.every((item) => item.type === 'media' && item.handle.startsWith('sfx:'))).toBe(
      true,
    );

    // Built-in sounds need no file from the run, and the generated music is a real artifact.
    const checks = await testApp.app
      .get(TimelineCheckService)
      .run({ runId: created.id, timeline: row!.data });
    expect(checks.find((check) => check.name === 'timeline.handles_resolve')).toMatchObject({
      pass: true,
    });
  });
});
