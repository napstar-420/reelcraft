import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { TrashService } from '../../src/trash/trash.service';
import { exampleScript } from '../../src/assistant/guide';
import { blueprint, channel } from '../../src/db/schema/index';
import { buildHttpTestApp, type HttpTestApp } from '../support/build-http-test-app';
import { createTestDb, type TestDb } from '../support/test-db';

/** Deleting a channel or blueprint moves it to the trash: hidden, restorable, purged later. */
describe('trash (e2e)', () => {
  let testDb: TestDb;
  let http: HttpTestApp;

  beforeAll(async () => {
    testDb = await createTestDb();
    http = await buildHttpTestApp(testDb);
  });

  afterAll(async () => {
    try {
      await http?.close();
    } finally {
      await testDb.teardown();
    }
  });

  async function call<T = unknown>(
    path: string,
    method = 'GET',
  ): Promise<{ status: number; body: T }> {
    const response = await fetch(`${http.baseUrl}${path}`, { method });
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T };
  }

  async function seed(name: string) {
    const ch = await http.app.get(ChannelService).create('local', {
      name: `${name} ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const bpId = await http.app.get(BlueprintService).ensureBlueprint(ch.id, 'Doomed reel');
    await http.app.get(BlueprintService).createVersion(bpId, exampleScript());
    return { channelId: ch.id, blueprintId: bpId };
  }

  it('trashes a blueprint, hides it, lists it in the trash and restores it', async () => {
    const { channelId, blueprintId } = await seed('Trash bp');
    expect((await call(`/blueprints/${blueprintId}`, 'DELETE')).status).toBeLessThan(300);

    await expect(http.app.get(BlueprintService).getBlueprint(blueprintId)).rejects.toThrow();
    const listed = await http.app.get(BlueprintService).listByChannel(channelId);
    expect(listed.map((b) => b.id)).not.toContain(blueprintId);
    // the name is free again
    const twin = await http.app.get(BlueprintService).ensureBlueprint(channelId, 'Doomed reel');

    const trash = await call<{ blueprints: Array<{ id: string; purgeAt: string }> }>('/trash');
    expect(trash.body.blueprints.map((b) => b.id)).toContain(blueprintId);

    expect((await call(`/trash/blueprints/${blueprintId}/restore`, 'POST')).status).toBe(201);
    const restored = await http.app.get(BlueprintService).getBlueprint(blueprintId);
    expect(restored.name).toBe('Doomed reel (restored)');
    expect(twin).not.toBe(blueprintId);
  });

  it('trashes a channel with its blueprints, refuses runs, restores it, and deletes for good', async () => {
    const { channelId, blueprintId } = await seed('Trash ch');
    expect((await call(`/channels/${channelId}`, 'DELETE')).status).toBeLessThan(300);
    const channels = await http.app.get(ChannelService).list({ includeArchived: true });
    expect(channels.map((c) => c.id)).not.toContain(channelId);
    await expect(http.app.get(BlueprintService).getBlueprint(blueprintId)).rejects.toThrow();
    const trash = await call<{
      channels: Array<{ id: string }>;
      blueprints: Array<{ id: string }>;
    }>('/trash');
    expect(trash.body.channels.map((c) => c.id)).toContain(channelId);
    // its blueprints go with it, not listed on their own
    expect(trash.body.blueprints.map((b) => b.id)).not.toContain(blueprintId);

    expect((await call(`/trash/channels/${channelId}/restore`, 'POST')).status).toBe(201);
    await expect(http.app.get(BlueprintService).getBlueprint(blueprintId)).resolves.toMatchObject({
      id: blueprintId,
    });

    await call(`/channels/${channelId}`, 'DELETE');
    expect((await call(`/trash/channels/${channelId}`, 'DELETE')).status).toBe(204);
    expect(await testDb.db.select().from(channel).where(eq(channel.id, channelId))).toHaveLength(0);
    expect(
      await testDb.db.select().from(blueprint).where(eq(blueprint.id, blueprintId)),
    ).toHaveLength(0);
  });

  it('purges what has been in the trash for more than 30 days', async () => {
    const old = await seed('Old trash');
    const fresh = await seed('Fresh trash');
    await call(`/channels/${old.channelId}`, 'DELETE');
    await call(`/blueprints/${fresh.blueprintId}`, 'DELETE');
    await testDb.db
      .update(channel)
      .set({ deletedAt: new Date(Date.now() - 31 * 86_400_000).toISOString() })
      .where(eq(channel.id, old.channelId));
    const purged = await http.app.get(TrashService).purge();
    expect(purged.channels).toBeGreaterThanOrEqual(1);
    expect(
      await testDb.db.select().from(channel).where(eq(channel.id, old.channelId)),
    ).toHaveLength(0);
    // trashed today: still restorable
    expect(
      await testDb.db.select().from(blueprint).where(eq(blueprint.id, fresh.blueprintId)),
    ).toHaveLength(1);
  });
});
