import { NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChannelService } from '../../src/channel/channel.service';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

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

    const all = await channels.list();
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
});
