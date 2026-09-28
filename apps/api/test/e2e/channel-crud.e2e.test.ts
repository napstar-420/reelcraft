import { ConflictException, NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { StageDef } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import { CharacterService } from '../../src/channel/character.service';
import { AssetService } from '../../src/channel/asset.service';
import { STORAGE_ADAPTER, type StorageAdapter } from '../../src/storage/storage.adapter';
import { run } from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

const MINIMAL_GRAPH: StageDef[] = [
  {
    key: 'draft',
    label: 'Draft',
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    retryLimit: 0,
    model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 256 } },
  },
];

describe('channel create/list/get/update (e2e)', () => {
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

  it('creates a channel and retrieves it by id', async () => {
    const channels = testApp.app.get(ChannelService);

    const created = await channels.create('local', {
      name: `Channel CRUD ${Date.now()}-${Math.random()}`,
      description: 'A test channel',
      theme: { label: 'Comedy' },
      defaults: {},
    });

    const fetched = await channels.get(created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe(created.name);
    expect(fetched.description).toBe('A test channel');
    expect(fetched.theme).toEqual({ label: 'Comedy' });
  });

  it('lists channels including a newly created one', async () => {
    const channels = testApp.app.get(ChannelService);
    const created = await channels.create('local', {
      name: `Channel CRUD List ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });

    const all = await channels.list({ includeArchived: false });
    expect(all.some((c) => c.id === created.id)).toBe(true);
  });

  it('throws NotFoundException when getting a missing channel', async () => {
    const channels = testApp.app.get(ChannelService);
    await expect(channels.get('does-not-exist')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates a subset of fields and leaves the rest unchanged', async () => {
    const channels = testApp.app.get(ChannelService);
    const created = await channels.create('local', {
      name: `Channel CRUD Update ${Date.now()}-${Math.random()}`,
      description: 'original description',
      theme: { label: 'Comedy' },
      defaults: {},
    });

    const updated = await channels.update(created.id, { name: 'Renamed channel' });
    expect(updated.name).toBe('Renamed channel');
    expect(updated.description).toBe('original description');
    expect(updated.theme).toEqual({ label: 'Comedy' });
  });

  it('throws NotFoundException when updating a missing channel', async () => {
    const channels = testApp.app.get(ChannelService);
    await expect(channels.update('does-not-exist', { name: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('archiving hides a channel from the default list and includeArchived brings it back', async () => {
    const channels = testApp.app.get(ChannelService);
    const created = await channels.create('local', {
      name: `Channel CRUD Archive ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });

    const archived = await channels.setArchived(created.id, true);
    expect(archived.archived).toBe(true);

    const defaultList = await channels.list({ includeArchived: false });
    expect(defaultList.some((c) => c.id === created.id)).toBe(false);
    const withArchived = await channels.list({ includeArchived: true });
    expect(withArchived.some((c) => c.id === created.id)).toBe(true);

    const restored = await channels.setArchived(created.id, false);
    expect(restored.archived).toBe(false);
    const afterRestore = await channels.list({ includeArchived: false });
    expect(afterRestore.some((c) => c.id === created.id)).toBe(true);
  });

  it('deletes a channel with no runs/blueprints and removes the row', async () => {
    const channels = testApp.app.get(ChannelService);
    const created = await channels.create('local', {
      name: `Channel CRUD Delete Empty ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });

    await channels.delete(created.id);
    await expect(channels.get(created.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects deleting a channel that still has a non-terminal run', async () => {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);

    const created = await channels.create('local', {
      name: `Channel CRUD Delete Active Run ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(created.id, 'Delete Guard Blueprint');
    const version = await blueprints.createVersion(blueprintId, {
      graph: MINIMAL_GRAPH,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    const dryRun = await runs.startDryRun(blueprintId, version.version);
    expect(dryRun.state).toBe('CREATED');

    await expect(channels.delete(created.id)).rejects.toBeInstanceOf(ConflictException);

    // Force the run terminal directly (no need to drive the full Inngest
    // pipeline just to prove the guard releases once endedAt is set).
    await testDb.db
      .update(run)
      .set({ state: 'CANCELLED', endedAt: new Date().toISOString() })
      .where(eq(run.id, dryRun.id));
    await channels.delete(created.id);
    await expect(channels.get(created.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reports counts of blueprints, characters, assets, and non-dry runs', async () => {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);
    const characters = testApp.app.get(CharacterService);
    const assets = testApp.app.get(AssetService);
    const storage = testApp.app.get<StorageAdapter>(STORAGE_ADAPTER);

    const created = await channels.create('local', {
      name: `Channel CRUD Counts ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    expect(created.counts).toEqual({ blueprints: 0, characters: 0, assets: 0, runs: 0 });

    const blueprintId = await blueprints.ensureBlueprint(created.id, 'Counts Blueprint');
    const version = await blueprints.createVersion(blueprintId, {
      graph: MINIMAL_GRAPH,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    await characters.create(created.id, { name: 'Counts Character', description: '' });
    const upload = await assets.requestUpload(created.id, 'png');
    await storage.put(upload.objectKey, Buffer.from('fake-png-bytes'), { mime: 'image/png' });
    await assets.create(created.id, {
      name: 'counts-asset',
      kind: 'media.image',
      blobId: upload.blobId,
      objectKey: upload.objectKey,
      sha256: 'deadbeef',
      tags: [],
    });
    await runs.startDryRun(blueprintId, version.version);
    await runs.create({
      channelId: created.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });

    const withCounts = await channels.get(created.id);
    expect(withCounts.counts).toEqual({ blueprints: 1, characters: 1, assets: 1, runs: 1 });

    const listed = await channels.list({ includeArchived: false });
    expect(listed.find((c) => c.id === created.id)?.counts).toEqual(withCounts.counts);
  });
});
