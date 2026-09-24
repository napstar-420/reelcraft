import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { InputDef, StageDef } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import { RunInputService } from '../../src/run/run-input.service';
import { RunController } from '../../src/run/run.controller';
import { STORAGE_ADAPTER, type StorageAdapter } from '../../src/storage/storage.adapter';
import { artifact } from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

function stage(key: string): StageDef {
  return {
    key,
    label: key,
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    retryLimit: 0,
    model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 256 } },
  };
}

const TOPIC_INPUT: InputDef = {
  key: 'topic',
  label: 'Topic',
  required: true,
  accepts: { kind: 'text' },
};
const OUTLINE_INPUT: InputDef = {
  key: 'outline',
  label: 'Outline',
  required: true,
  accepts: {
    kind: 'data',
    schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
  },
};
const PHOTO_INPUT: InputDef = {
  key: 'photo',
  label: 'Photo',
  required: true,
  accepts: { kind: 'media.image', cardinality: 'one' },
};
const GALLERY_INPUT: InputDef = {
  key: 'gallery',
  label: 'Gallery',
  required: false,
  accepts: { kind: 'media.image', cardinality: 'many' },
};

/**
 * §6.2/§21 — declared run inputs as `$input:<key>` artifacts, and the
 * create/start split (§6.2's "media inputs are uploaded before start")
 * plus the presigned-upload/attach flow media inputs need.
 */
describe('run inputs as artifacts (e2e)', () => {
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

  async function setup(inputs: InputDef[]) {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);

    const channel = await channels.create('local', {
      name: `Run Inputs Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Run Inputs Blueprint');
    const version = await blueprints.createVersion(blueprintId, {
      graph: [stage('outline')],
      inputs,
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    expect(version.runnable).toBe(true);
    return { runs, version, channel };
  }

  it('records a text input provided at create() as a $input:<key> artifact', async () => {
    const { runs, version, channel } = await setup([TOPIC_INPUT]);
    const created = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: { topic: 'coral reefs' },
      roleBindings: {},
      budgetCapUsd: 10,
    });

    const rows = await testDb.db
      .select()
      .from(artifact)
      .where(and(eq(artifact.runId, created.id), eq(artifact.producerStageKey, '$input:topic')));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.stale).toBe(false);
    expect(rows[0]?.userAuthored).toBe(true);
    expect(rows[0]?.data).toEqual({ text: 'coral reefs' });
  });

  it('records a data input at create() with its schema_hash', async () => {
    const { runs, version, channel } = await setup([OUTLINE_INPUT]);
    const created = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: { outline: { title: 'Coral Reefs' } },
      roleBindings: {},
      budgetCapUsd: 10,
    });

    const [row] = await testDb.db
      .select()
      .from(artifact)
      .where(and(eq(artifact.runId, created.id), eq(artifact.producerStageKey, '$input:outline')));
    expect(row?.data).toEqual({ title: 'Coral Reefs' });
    expect(row?.schemaHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('create() throws when a data input fails its declared schema', async () => {
    const { runs, version, channel } = await setup([OUTLINE_INPUT]);
    await expect(
      runs.create({
        channelId: channel.id,
        blueprintVersionId: version.id,
        inputs: { outline: { wrongField: true } },
        roleBindings: {},
        budgetCapUsd: 10,
      }),
    ).rejects.toThrow(/does not match its declared schema/);
  });

  it('start() throws naming a required input that was never provided', async () => {
    const { runs, version, channel } = await setup([TOPIC_INPUT]);
    const created = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 10,
    });
    await expect(runs.start(created.id)).rejects.toThrow(/required input "topic"/);
  });

  it('uploads a media input, attaches it, and start() succeeds — cardinality "one"', async () => {
    const { runs, version, channel } = await setup([PHOTO_INPUT]);
    const created = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 10,
    });

    const runInputs = testApp.app.get(RunInputService);
    const storage = testApp.app.get<StorageAdapter>(STORAGE_ADAPTER);

    const upload = await runInputs.requestMediaUpload(created.id, 'photo', 'jpg');
    // Simulates the client's real PUT to the presigned URL.
    await storage.put(upload.objectKey, Buffer.from('fake-jpeg-bytes'), { mime: 'image/jpeg' });

    await runInputs.attachMediaInput(created.id, 'photo', [
      { blobId: upload.blobId, objectKey: upload.objectKey, sha256: 'deadbeef' },
    ]);

    const [row] = await testDb.db
      .select()
      .from(artifact)
      .where(and(eq(artifact.runId, created.id), eq(artifact.producerStageKey, '$input:photo')));
    expect(row?.kind).toBe('media.image');
    expect(row?.blobId).toBe(upload.blobId);
    expect(row?.itemIndex).toBeNull();
    expect(row?.stale).toBe(false);

    const started = await runs.start(created.id);
    expect(started.id).toBe(created.id);
  });

  it('attaches a "many"-cardinality media input with correct item_index per blob', async () => {
    const { runs, version, channel } = await setup([GALLERY_INPUT]);
    const created = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 10,
    });

    const runInputs = testApp.app.get(RunInputService);
    const storage = testApp.app.get<StorageAdapter>(STORAGE_ADAPTER);

    const uploads = await Promise.all([
      runInputs.requestMediaUpload(created.id, 'gallery', 'jpg'),
      runInputs.requestMediaUpload(created.id, 'gallery', 'jpg'),
    ]);
    for (const upload of uploads) {
      await storage.put(upload.objectKey, Buffer.from('bytes'), { mime: 'image/jpeg' });
    }

    await runInputs.attachMediaInput(
      created.id,
      'gallery',
      uploads.map((u) => ({ blobId: u.blobId, objectKey: u.objectKey, sha256: 'deadbeef' })),
    );

    const rows = await testDb.db
      .select()
      .from(artifact)
      .where(and(eq(artifact.runId, created.id), eq(artifact.producerStageKey, '$input:gallery')))
      .orderBy(artifact.itemIndex);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.itemIndex)).toEqual([0, 1]);
  });

  it('attachMediaInput throws when the blob count does not match cardinality "one"', async () => {
    const { runs, version, channel } = await setup([PHOTO_INPUT]);
    const created = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 10,
    });

    const runInputs = testApp.app.get(RunInputService);
    const storage = testApp.app.get<StorageAdapter>(STORAGE_ADAPTER);
    const uploads = await Promise.all([
      runInputs.requestMediaUpload(created.id, 'photo', 'jpg'),
      runInputs.requestMediaUpload(created.id, 'photo', 'jpg'),
    ]);
    for (const upload of uploads) {
      await storage.put(upload.objectKey, Buffer.from('bytes'), { mime: 'image/jpeg' });
    }

    await expect(
      runInputs.attachMediaInput(
        created.id,
        'photo',
        uploads.map((u) => ({ blobId: u.blobId, objectKey: u.objectKey, sha256: 'deadbeef' })),
      ),
    ).rejects.toThrow(/cardinality "one"/);
  });

  it('the full upload -> attach -> start flow works through RunController', async () => {
    // Direct method calls, like every other e2e suite's `controller.xyz(...)`
    // calls in this codebase — NestJS's `@Body(new ZodValidationPipe(...))`
    // only runs through the framework's real HTTP/routing dispatch, so this
    // proves the controller's parameter wiring and DI graph, not the pipe
    // itself (no suite in this repo drives a real HTTP request — see
    // `README`'s test conventions).
    const { version, channel } = await setup([PHOTO_INPUT]);
    const controller = testApp.app.get(RunController);
    const storage = testApp.app.get<StorageAdapter>(STORAGE_ADAPTER);

    const created = await controller.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 10,
    });

    const upload = await controller.requestInputUpload(created.id, 'photo', { ext: 'jpg' });
    await storage.put(upload.objectKey, Buffer.from('bytes'), { mime: 'image/jpeg' });
    await controller.attachInput(created.id, 'photo', {
      blobs: [{ blobId: upload.blobId, objectKey: upload.objectKey, sha256: 'deadbeef' }],
    });

    const started = await controller.start(created.id);
    expect(started.id).toBe(created.id);
  });
});
