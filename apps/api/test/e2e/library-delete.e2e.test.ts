import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { StageDef } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { CharacterService } from '../../src/channel/character.service';
import { AssetService } from '../../src/channel/asset.service';
import { RunService } from '../../src/run/run.service';
import { BlobService } from '../../src/artifact/blob.service';
import { STORAGE_ADAPTER } from '../../src/storage/storage.adapter';
import { storageOrphan } from '../../src/db/schema/index';
import type { MemoryStorageAdapter } from '../support/memory-storage.adapter';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

/** Deleting assets, characters and reference images: names are freed, files
 * are queued in `storage_orphan`, and the `blob.gc` sweep deletes them after
 * the retention period. */
describe('library deletes and storage cleanup (e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;
  let storage: MemoryStorageAdapter;

  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb);
    storage = testApp.app.get<MemoryStorageAdapter>(STORAGE_ADAPTER);
  });

  afterAll(async () => {
    try {
      await testApp?.close();
    } finally {
      await testDb.teardown();
    }
  });

  async function newChannel() {
    return testApp.app.get(ChannelService).create('local', {
      name: `Library Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
  }

  async function uploadAsset(channelId: string, name: string) {
    const assets = testApp.app.get(AssetService);
    const upload = await assets.requestUpload(channelId, 'png');
    await storage.put(upload.objectKey, Buffer.from('png'), { mime: 'image/png' });
    return {
      upload,
      create: () =>
        assets.create(channelId, {
          name,
          kind: 'media.image',
          blobId: upload.blobId,
          objectKey: upload.objectKey,
          sha256: 'deadbeef',
          tags: [],
        }),
    };
  }

  async function addReference(characterId: string) {
    const characters = testApp.app.get(CharacterService);
    const upload = await characters.requestReferenceUpload(characterId, 'png');
    await storage.put(upload.objectKey, Buffer.from('png'), { mime: 'image/png' });
    await characters.confirmReference(characterId, {
      blobId: upload.blobId,
      objectKey: upload.objectKey,
      sha256: 'deadbeef',
      view: 'front',
    });
    return upload;
  }

  async function queuedKeys(keys: string[]) {
    return (
      await testDb.db
        .select({ objectKey: storageOrphan.objectKey })
        .from(storageOrphan)
        .where(inArray(storageOrphan.objectKey, keys))
    ).map((row) => row.objectKey);
  }

  it('frees a deleted asset name, refuses a live duplicate and queues the file', async () => {
    const channel = await newChannel();
    const assets = testApp.app.get(AssetService);
    const first = await uploadAsset(channel.id, 'Logo');
    const created = await first.create();

    const duplicate = await uploadAsset(channel.id, 'Logo');
    const error = await duplicate
      .create()
      .then(() => undefined)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'asset_name_taken',
    });
    // The rejected upload is queued for cleanup too.
    expect(await queuedKeys([duplicate.upload.objectKey])).toEqual([duplicate.upload.objectKey]);

    await assets.delete(created.id);
    expect((await assets.list(channel.id)).map((a) => a.id)).not.toContain(created.id);
    expect(await queuedKeys([first.upload.objectKey])).toEqual([first.upload.objectKey]);

    const again = await uploadAsset(channel.id, 'Logo');
    await expect(again.create()).resolves.toMatchObject({ name: 'Logo' });
  });

  it('deletes a character: hidden, files queued, blueprints and new runs refuse it', async () => {
    const channel = await newChannel();
    const characters = testApp.app.get(CharacterService);
    const blueprints = testApp.app.get(BlueprintService);
    const host = await characters.create(channel.id, { name: 'Maya', description: 'Presenter' });
    const ref = await addReference(host.id);

    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Uses Maya');
    const stage: StageDef = {
      key: 'image',
      label: 'Image',
      capability: 'image.generate',
      config: {},
      slots: { references: { from: 'role', roleKey: 'host' } },
      context: {},
      output: { kind: 'media.image' },
      checks: [],
      retryLimit: 0,
      model: { provider: 'fake', modelId: 'fake-image-1', params: {} },
    };
    const save = () =>
      blueprints.createVersion(blueprintId, {
        graph: [stage],
        inputs: [],
        roles: [
          {
            key: 'host',
            label: 'Host',
            required: true,
            characterId: host.id,
            referenceBlobIds: [ref.blobId],
          },
        ],
        defaults: {},
        budget: { runCapUsd: 5 },
      });
    const before = await save();
    expect(before.validation.filter((issue) => issue.severity === 'error')).toEqual([]);

    await characters.delete(host.id);

    expect((await characters.list(channel.id)).map((c) => c.id)).not.toContain(host.id);
    await expect(characters.get(host.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(await queuedKeys([ref.objectKey])).toEqual([ref.objectKey]);
    const after = await save();
    expect(after.runnable).toBe(false);
    expect(after.validation).toContainEqual(
      expect.objectContaining({ path: 'roles.host', message: expect.stringMatching(/deleted/) }),
    );

    // A run created from the version saved before the delete can't start.
    const runs = testApp.app.get(RunService);
    const created = await runs.create({
      channelId: channel.id,
      blueprintVersionId: before.id,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 5,
    });
    await expect(runs.start(created.id)).rejects.toThrow(/was deleted/);
  });

  it('queues a deleted reference image', async () => {
    const channel = await newChannel();
    const characters = testApp.app.get(CharacterService);
    const host = await characters.create(channel.id, { name: 'Sam', description: '' });
    const ref = await addReference(host.id);
    await characters.deleteReference(host.id, ref.blobId);
    expect(await queuedKeys([ref.objectKey])).toEqual([ref.objectKey]);
  });

  it('collects queued files only after the retention period', async () => {
    const blobs = testApp.app.get(BlobService);
    const fresh = 'local/test/fresh.bin';
    const old = 'local/test/old.bin';
    await storage.put(fresh, Buffer.from('x'), { mime: 'application/octet-stream' });
    await storage.put(old, Buffer.from('x'), { mime: 'application/octet-stream' });
    await testDb.db.insert(storageOrphan).values([
      { objectKey: fresh, reason: 'asset_deleted' },
      { objectKey: old, reason: 'asset_deleted', queuedAt: '2000-01-01T00:00:00.000Z' },
    ]);

    await blobs.collectOrphans();

    expect(storage.has(old)).toBe(false);
    expect(storage.has(fresh)).toBe(true);
    expect(await queuedKeys([old, fresh])).toEqual([fresh]);
    await testDb.db.delete(storageOrphan).where(eq(storageOrphan.objectKey, fresh));
  });

  it('queues folders left by channels and characters that no longer exist', async () => {
    const blobs = testApp.app.get(BlobService);
    const live = await newChannel();
    const goneChannel = '01ZZZZZZZZZZZZZZZZZZZZZZZZ';
    const goneCharacter = '01YYYYYYYYYYYYYYYYYYYYYYYY';
    const keys = {
      live: `local/${live.id}/assets/a.png`,
      goneChannel: `local/${goneChannel}/run/media/b.png`,
      goneCharacter: `local/characters/${goneCharacter}/refs/c.png`,
      notAnId: `local/not-an-id/d.png`,
    };
    for (const key of Object.values(keys)) {
      await storage.put(key, Buffer.from('x'), { mime: 'image/png' });
    }

    await blobs.queueOrphanedFolders();

    expect((await queuedKeys(Object.values(keys))).sort()).toEqual(
      [keys.goneChannel, keys.goneCharacter].sort(),
    );
  });
});
