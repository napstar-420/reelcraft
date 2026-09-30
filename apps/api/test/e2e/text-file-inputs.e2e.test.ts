import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { StageDef } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { run as runTable, stageAttempt } from '../../src/db/schema/index';
import { CharacterService } from '../../src/channel/character.service';
import { AssetService } from '../../src/channel/asset.service';
import type { RoleBinding } from '../../src/artifact/binding-resolver.service';
import { STORAGE_ADAPTER, type StorageAdapter } from '../../src/storage/storage.adapter';
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

  it('attaches a Character role to a text stage and renders it as Character text', async () => {
    const { channelId, blueprintId } = await newBlueprint('Role Context');
    const storage = testApp.app.get<StorageAdapter>(STORAGE_ADAPTER);
    const characters = testApp.app.get(CharacterService);
    const host = await characters.create(channelId, {
      name: 'Maya',
      description: 'Late-20s presenter, short dark hair',
    });
    const reference = async (view: 'front' | 'profile' | 'full_body', caption?: string) => {
      const upload = await characters.requestReferenceUpload(host.id, 'png');
      await storage.put(upload.objectKey, Buffer.from('png'), { mime: 'image/png' });
      await characters.confirmReference(host.id, {
        blobId: upload.blobId,
        objectKey: upload.objectKey,
        sha256: 'deadbeef',
        view,
        ...(caption && { caption }),
      });
      return upload.blobId;
    };
    const front = await reference('front');
    const profile = await reference('profile', 'looking left');
    const body = await reference('full_body');
    await characters.setPrimary(host.id, profile);

    const assetUpload = await testApp.app.get(AssetService).requestUpload(channelId, 'png');
    await storage.put(assetUpload.objectKey, Buffer.from('png'), { mime: 'image/png' });
    const studio = await testApp.app.get(AssetService).create(channelId, {
      name: 'Studio',
      kind: 'media.image',
      blobId: assetUpload.blobId,
      objectKey: assetUpload.objectKey,
      sha256: 'deadbeef',
      tags: [],
    });

    const save = (referenceBlobIds: string[], attach: string[]) =>
      testApp.app.get(BlueprintService).createVersion(blueprintId, {
        graph: [
          textStage({
            context: {
              character: { from: 'role', roleKey: 'host' },
              background: { from: 'asset', assetId: studio.id },
            },
            attach,
            instructions: { template: 'Direct {{ character }} in the studio.' },
            model: { provider: 'fake', modelId: 'fake-text-vision', params: {} },
          }),
        ],
        inputs: [],
        roles: [
          { key: 'host', label: 'Host', required: true, characterId: host.id, referenceBlobIds },
        ],
        defaults: {},
        budget: { runCapUsd: 10 },
      });

    // Not attached: a role in Context would only interpolate image records.
    const unattached = await save([front], ['background']);
    expect(unattached.validation).toContainEqual(
      expect.objectContaining({
        path: 'stages.caption.context.character',
        message: expect.stringMatching(/must be attached as a file/),
      }),
    );
    // 3 character images + the background exceed the model's 3-file cap.
    const overLimit = await save([front, profile, body], ['character', 'background']);
    expect(overLimit.validation).toContainEqual(
      expect.objectContaining({
        path: 'stages.caption.attach',
        message: expect.stringMatching(
          /attaches 4 files but model "fake-text-vision" reads at most 3/,
        ),
      }),
    );

    const version = await save([front, profile], ['character', 'background']);
    expect(version.runnable).toBe(true);

    const runs = testApp.app.get(RunService);
    const created = await runs.create({
      channelId,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });
    await runs.start(created.id);
    const [started] = await testDb.db
      .select({ roleBindings: runTable.roleBindings })
      .from(runTable)
      .where(eq(runTable.id, created.id));
    const snapshot = (started?.roleBindings as Record<string, RoleBinding>).host!;
    // Primary first, each image keeping its view and caption.
    expect(
      snapshot.references.map(({ blobId, view, caption }) => ({ blobId, view, caption })),
    ).toEqual([
      { blobId: profile, view: 'profile', caption: 'looking left' },
      { blobId: front, view: 'front', caption: undefined },
    ]);

    await testDb.db.update(runTable).set({ state: 'RUNNING' }).where(eq(runTable.id, created.id));
    const execution = created.stageExecutions.find((e) => e.stageKey === 'caption')!;
    const stageRunner = testApp.app.get(StageRunnerService);
    const { stage, effective, prevStageKey } = await stageRunner.loadStageContext(
      created.id,
      'caption',
    );
    const attemptCtx = await stageRunner.beginAttempt({
      runId: created.id,
      stageExecutionId: execution.id,
      stageKey: 'caption',
    });
    const submission = await stageRunner.reserveAndSubmit(
      stage,
      attemptCtx,
      prevStageKey,
      effective,
    );
    expect(submission.outcome).toBe('submitted');
    const [attempt] = await testDb.db
      .select({ renderedPrompt: stageAttempt.renderedPrompt })
      .from(stageAttempt)
      .where(eq(stageAttempt.id, attemptCtx.stageAttemptId));
    expect(attempt?.renderedPrompt).toContain(
      'Direct Name: Maya\nDescription: Late-20s presenter, short dark hair\n' +
        'Reference images (attached): character[1] profile (looking left), character[2] front in the studio.',
    );
    expect(attempt?.renderedPrompt).toContain('1. character[1] (media.image)');
    expect(attempt?.renderedPrompt).toContain('3. background (media.image)');
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
