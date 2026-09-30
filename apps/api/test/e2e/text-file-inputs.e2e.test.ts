import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { StageDef } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { run as runTable, stageAttempt } from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

function textStage(overrides: Partial<StageDef>): StageDef {
  return {
    key: 'caption',
    label: 'Caption',
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    instructions: { template: 'Write a caption.' },
    output: { kind: 'text' },
    checks: [],
    retryLimit: 2,
    model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 64 } },
    ...overrides,
  } as StageDef;
}

describe('text.generate file inputs and model error replies (e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;

  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb);
  });

  afterAll(async () => {
    try {
      await testApp?.close();
    } finally {
      await testDb.teardown();
    }
  });

  async function newBlueprint(name: string) {
    const channel = await testApp.app
      .get(ChannelService)
      .create('local', { name, theme: {}, defaults: {} });
    const blueprintId = await testApp.app.get(BlueprintService).ensureBlueprint(channel.id, name);
    return { channelId: channel.id, blueprintId };
  }

  it('validates attached context files against the model, and only attached ones', async () => {
    const { blueprintId } = await newBlueprint('File Input Validation');
    const imageStage: StageDef = {
      key: 'shot',
      label: 'Shot',
      capability: 'image.generate',
      config: {},
      slots: {},
      context: {},
      output: { kind: 'media.image' },
      checks: [],
      retryLimit: 0,
      model: { provider: 'fake', modelId: 'fake-image-1', params: {} },
    };
    const save = (caption: StageDef) =>
      testApp.app.get(BlueprintService).createVersion(blueprintId, {
        graph: [imageStage, caption],
        inputs: [],
        roles: [],
        defaults: {},
        budget: { runCapUsd: 10 },
      });

    // Bound for its JSON record only (e.g. handles) — not attached, so valid.
    const handlesOnly = await save(textStage({ context: { shot: { from: 'prev' } } }));
    expect(handlesOnly.runnable).toBe(true);

    const unknownKey = await save(textStage({ attach: ['missing'] }));
    expect(unknownKey.validation).toContainEqual(
      expect.objectContaining({ path: 'stages.caption.attach', severity: 'error' }),
    );

    const version = await save(
      textStage({ context: { shot: { from: 'prev' } }, attach: ['shot'] }),
    );
    expect(version.runnable).toBe(false);
    expect(version.validation).toContainEqual(
      expect.objectContaining({
        path: 'stages.caption.context.shot',
        message: expect.stringMatching(/can't read media\.image inputs/),
        severity: 'error',
      }),
    );
  });

  it('fails the stage with the model message when it replies with a structured error', async () => {
    const { channelId, blueprintId } = await newBlueprint('Model Error Reply');
    const reply = '{"reelcraft_error":{"code":"input_missing","message":"No script provided."}}';
    const version = await testApp.app.get(BlueprintService).createVersion(blueprintId, {
      graph: [
        textStage({
          model: { provider: 'fake', modelId: 'fake-text-1', params: { fakeOutput: reply } },
        }),
      ],
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    expect(version.runnable).toBe(true);

    const run = await testApp.app.get(RunService).create({
      channelId,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });
    await testDb.db.update(runTable).set({ state: 'RUNNING' }).where(eq(runTable.id, run.id));
    const execution = run.stageExecutions.find((e) => e.stageKey === 'caption')!;
    const stageRunner = testApp.app.get(StageRunnerService);
    const { stage, effective, prevStageKey } = await stageRunner.loadStageContext(
      run.id,
      'caption',
    );
    const attemptCtx = await stageRunner.beginAttempt({
      runId: run.id,
      stageExecutionId: execution.id,
      stageKey: 'caption',
    });
    const submission = await stageRunner.reserveAndSubmit(
      stage,
      attemptCtx,
      prevStageKey,
      effective,
    );
    if (submission.outcome !== 'submitted') throw new Error(`got ${submission.outcome}`);

    const [attemptBefore] = await testDb.db
      .select({ renderedPrompt: stageAttempt.renderedPrompt })
      .from(stageAttempt)
      .where(eq(stageAttempt.id, attemptCtx.stageAttemptId));
    expect(attemptBefore?.renderedPrompt).toContain('<error_reporting>');

    await stageRunner.pollOnce(stage, submission.handle);
    const fetched = await stageRunner.fetchAndFinalize(
      stage,
      attemptCtx,
      submission.handle,
      prevStageKey,
      effective,
    );

    expect(fetched).toEqual({
      outcome: 'model_error',
      reason: 'Model reported input_missing: No script provided.',
    });
    const [attempt] = await testDb.db
      .select({ outcome: stageAttempt.outcome, artifactId: stageAttempt.artifactId })
      .from(stageAttempt)
      .where(eq(stageAttempt.id, attemptCtx.stageAttemptId));
    expect(attempt).toEqual({ outcome: 'provider_error', artifactId: null });
  });
});
