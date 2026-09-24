import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { StageDef } from '@reefcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { AssetService } from '../../src/channel/asset.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import { STORAGE_ADAPTER, type StorageAdapter } from '../../src/storage/storage.adapter';
import { asset, blob, run } from '../../src/db/schema/index';
import { ulid } from '../../src/common/ulid';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

/**
 * §3.3/§3.7/§6.2 — channel assets: the upload/create flow, `{from:'asset'}`
 * resolving through save-time validation, and the run-time immutability
 * guarantee (`run.assetBindings` is a snapshot at `start()`, never a live
 * read of the `asset` table).
 */
describe('channel assets (e2e)', () => {
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

  async function uploadAsset(channelId: string, name: string) {
    const assets = testApp.app.get(AssetService);
    const storage = testApp.app.get<StorageAdapter>(STORAGE_ADAPTER);

    const upload = await assets.requestUpload(channelId, 'png');
    await storage.put(upload.objectKey, Buffer.from('fake-png-bytes'), { mime: 'image/png' });
    return assets.create(channelId, {
      name,
      kind: 'media.image',
      blobId: upload.blobId,
      objectKey: upload.objectKey,
      sha256: 'deadbeef',
      tags: [],
    });
  }

  it('a stage binding {from:"asset"} to a same-channel media asset validates and resolves', async () => {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);

    const channel = await channels.create('local', {
      name: `Channel Assets Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const logo = await uploadAsset(channel.id, `logo-${Date.now()}`);

    const graph: StageDef[] = [
      {
        key: 'brand',
        label: 'Brand',
        capability: 'text.generate',
        config: {},
        slots: {},
        context: { logo: { from: 'asset', assetId: logo.id } },
        output: { kind: 'text' },
        checks: [],
        retryLimit: 0,
        model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 256 } },
      },
    ];
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Channel Assets Blueprint');
    const version = await blueprints.createVersion(blueprintId, {
      graph,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    expect(version.runnable).toBe(true);
  });

  it('run.assetBindings snapshots the asset at start() and is immune to a later asset edit', async () => {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);

    const channel = await channels.create('local', {
      name: `Channel Assets Immutability Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const logo = await uploadAsset(channel.id, `logo-${Date.now()}`);
    const originalBlobId = logo.blobId;

    const graph: StageDef[] = [
      {
        key: 'brand',
        label: 'Brand',
        capability: 'text.generate',
        config: {},
        slots: {},
        context: { logo: { from: 'asset', assetId: logo.id } },
        output: { kind: 'text' },
        checks: [],
        retryLimit: 0,
        model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 256 } },
      },
    ];
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Immutability Blueprint');
    const version = await blueprints.createVersion(blueprintId, {
      graph,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    expect(version.runnable).toBe(true);

    const created = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 10,
    });
    await runs.start(created.id);

    const [beforeEdit] = await testDb.db.select().from(run).where(eq(run.id, created.id)).limit(1);
    const snapshot = beforeEdit?.assetBindings as Record<string, { blobId: string; kind: string }>;
    expect(snapshot[logo.id]).toEqual({ blobId: originalBlobId, kind: 'media.image' });

    // Simulate a later channel-asset edit (repointing the asset at a
    // different blob) — direct DB write since AssetService has no "update".
    const replacementBlobId = ulid();
    await testDb.db.insert(blob).values({
      id: replacementBlobId,
      ownerId: 'local',
      scope: 'asset',
      bucket: 'video-engine',
      objectKey: `local/${channel.id}/assets/${replacementBlobId}.png`,
      mime: 'image/png',
      bytes: 10,
      sha256: 'replacement',
    });
    await testDb.db.update(asset).set({ blobId: replacementBlobId }).where(eq(asset.id, logo.id));

    const [afterEdit] = await testDb.db.select().from(run).where(eq(run.id, created.id)).limit(1);
    const stillSnapshot = afterEdit?.assetBindings as Record<
      string,
      { blobId: string; kind: string }
    >;
    expect(stillSnapshot[logo.id]?.blobId).toBe(originalBlobId); // unchanged — a snapshot, not a live read
  });

  it('start() throws when a referenced asset was soft-deleted after save', async () => {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);
    const assets = testApp.app.get(AssetService);

    const channel = await channels.create('local', {
      name: `Channel Assets Deleted Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const logo = await uploadAsset(channel.id, `logo-${Date.now()}`);

    const graph: StageDef[] = [
      {
        key: 'brand',
        label: 'Brand',
        capability: 'text.generate',
        config: {},
        slots: {},
        context: { logo: { from: 'asset', assetId: logo.id } },
        output: { kind: 'text' },
        checks: [],
        retryLimit: 0,
        model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 256 } },
      },
    ];
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Deleted Asset Blueprint');
    const version = await blueprints.createVersion(blueprintId, {
      graph,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    expect(version.runnable).toBe(true);

    const created = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 10,
    });

    await assets.delete(logo.id);

    await expect(runs.start(created.id)).rejects.toThrow(/no longer exists/);
  });
});
