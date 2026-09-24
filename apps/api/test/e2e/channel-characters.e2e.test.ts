import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { ReferenceImage } from '@reefcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { CharacterService } from '../../src/channel/character.service';
import { STORAGE_ADAPTER, type StorageAdapter } from '../../src/storage/storage.adapter';
import { blob, character } from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

/** §3.2/§18 — channel character lifecycle: create, upload+confirm a
 * reference image (readiness flips to 'ready'), edit/set-primary/delete a
 * reference (primaryRefId clears when the deleted blob was primary), and
 * confirm delete soft-deletes only the blob, not the character. */
describe('channel characters (e2e)', () => {
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

  async function uploadReference(characterId: string, view: 'front' | 'profile' = 'front') {
    const characters = testApp.app.get(CharacterService);
    const storage = testApp.app.get<StorageAdapter>(STORAGE_ADAPTER);

    const upload = await characters.requestReferenceUpload(characterId, 'png');
    await storage.put(upload.objectKey, Buffer.from('fake-png-bytes'), { mime: 'image/png' });
    return characters.confirmReference(characterId, {
      blobId: upload.blobId,
      objectKey: upload.objectKey,
      sha256: 'deadbeef',
      view,
    });
  }

  it('runs the full character + reference-image lifecycle', async () => {
    const channels = testApp.app.get(ChannelService);
    const characters = testApp.app.get(CharacterService);

    const channel = await channels.create('local', {
      name: `Channel Characters Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });

    const created = await characters.create(channel.id, {
      name: 'Ada',
      description: 'A curious explorer',
    });
    expect(created.readiness).toBe('draft');
    expect(created.referenceSet).toEqual([]);

    const afterFirstRef = await uploadReference(created.id, 'front');
    expect(afterFirstRef.readiness).toBe('ready');
    const firstRefs = afterFirstRef.referenceSet as ReferenceImage[];
    expect(firstRefs).toHaveLength(1);
    const firstBlobId = firstRefs[0]!.blobId;
    expect(afterFirstRef.primaryRefId).toBeNull();

    const afterSecondRef = await uploadReference(created.id, 'profile');
    expect(afterSecondRef.referenceSet as ReferenceImage[]).toHaveLength(2);

    const afterUpdate = await characters.updateReference(created.id, firstBlobId, {
      caption: 'Front-facing hero shot',
    });
    const updatedRefs = afterUpdate.referenceSet as ReferenceImage[];
    expect(updatedRefs.find((r) => r.blobId === firstBlobId)?.caption).toBe(
      'Front-facing hero shot',
    );

    const afterPrimary = await characters.setPrimary(created.id, firstBlobId);
    expect(afterPrimary.primaryRefId).toBe(firstBlobId);

    await characters.deleteReference(created.id, firstBlobId);
    const afterDelete = await characters.get(created.id);
    expect(afterDelete.referenceSet as ReferenceImage[]).toHaveLength(1);
    expect(afterDelete.primaryRefId).toBeNull(); // cleared — the deleted blob was primary

    const [deletedBlob] = await testDb.db.select().from(blob).where(eq(blob.id, firstBlobId));
    expect(deletedBlob?.deletedAt).not.toBeNull();

    const [characterRow] = await testDb.db
      .select()
      .from(character)
      .where(eq(character.id, created.id));
    expect(characterRow).toBeDefined(); // the character itself is untouched by the reference delete
  });
});
