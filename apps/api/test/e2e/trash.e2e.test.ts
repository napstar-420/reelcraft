import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { TrashService } from '../../src/trash/trash.service';
import { RunService } from '../../src/run/run.service';
import { RunInsightService } from '../../src/run/run-insight.service';
import { RunMutationService } from '../../src/run/run-mutation.service';
import { RUN_ACTION_ALLOWED_STATES } from '../../src/run/run-action-policy';
import { exampleScript } from '../../src/assistant/guide';
import { blueprint, channel, run } from '../../src/db/schema/index';
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
    const version = await http.app.get(BlueprintService).createVersion(bpId, exampleScript());
    return { channelId: ch.id, blueprintId: bpId, versionId: version.id };
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

  it("hides a trashed blueprint's finished runs and refuses to work on them", async () => {
    const { channelId, blueprintId, versionId } = await seed('Trash runs');
    const runs = http.app.get(RunService);
    const created = await runs.create(
      {
        channelId,
        blueprintVersionId: versionId,
        inputs: { topic: 'otters' },
        roleBindings: {},
        budgetCapUsd: 0,
        rerunStageKeys: [],
        dryRun: true,
      },
      { dryRun: true },
    );
    const listedIds = async () => ({
      page: (await runs.list({ includeDryRuns: true, channelId } as never)).items.map(
        (r: { id: string }) => r.id,
      ),
      assistant: (await http.app.get(RunInsightService).list({ channelId, limit: 20 })).runs.map(
        (r) => r.runId,
      ),
    });
    expect(await listedIds()).toEqual({ page: [created.id], assistant: [created.id] });

    // a blueprint with a run in progress can't be trashed, so the run has finished
    await testDb.db
      .update(run)
      .set({ state: 'COMPLETED', endedAt: new Date().toISOString() })
      .where(eq(run.id, created.id));
    const mutations = http.app.get(RunMutationService);
    const editOutput = () =>
      mutations.withLockedRun(
        created.id,
        'edit_artifact',
        RUN_ACTION_ALLOWED_STATES.edit_artifact,
        async () => 0,
      );
    await expect(editOutput()).resolves.toMatchObject({ value: 0 });

    expect((await call(`/blueprints/${blueprintId}`, 'DELETE')).status).toBeLessThan(300);
    expect(await listedIds()).toEqual({ page: [], assistant: [] });
    // re-running, retrying or re-rendering would spend money on something in the trash
    await expect(editOutput()).rejects.toMatchObject({ response: { code: 'run_in_trash' } });
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

  it('does not purge something that was restored after the purge picked it', async () => {
    const { channelId, blueprintId } = await seed('Restored in time');
    const blueprints = http.app.get(BlueprintService);
    const longAgo = new Date(Date.now() - 31 * 86_400_000).toISOString();
    const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
    await call(`/blueprints/${blueprintId}`, 'DELETE');
    await testDb.db
      .update(blueprint)
      .set({ deletedAt: longAgo })
      .where(eq(blueprint.id, blueprintId));
    // the purge read its list, then the user restored it
    await call(`/trash/blueprints/${blueprintId}/restore`, 'POST');
    expect(await blueprints.delete(blueprintId, { onlyTrashedBefore: cutoff })).toBe(false);
    expect(
      await testDb.db.select().from(blueprint).where(eq(blueprint.id, blueprintId)),
    ).toHaveLength(1);
    // trashed again today: not past the cutoff either
    await call(`/blueprints/${blueprintId}`, 'DELETE');
    expect(await blueprints.delete(blueprintId, { onlyTrashedBefore: cutoff })).toBe(false);
    // and the same for a channel
    const channels = http.app.get(ChannelService);
    await call(`/channels/${channelId}`, 'DELETE');
    await call(`/trash/channels/${channelId}/restore`, 'POST');
    expect(await channels.delete(channelId, { onlyTrashedBefore: cutoff })).toBe(false);
    expect(await testDb.db.select().from(channel).where(eq(channel.id, channelId))).toHaveLength(1);
    // old enough and still in the trash: deleted
    await call(`/blueprints/${blueprintId}`, 'DELETE').catch(() => undefined);
    await testDb.db
      .update(blueprint)
      .set({ deletedAt: longAgo })
      .where(eq(blueprint.id, blueprintId));
    expect(await blueprints.delete(blueprintId, { onlyTrashedBefore: cutoff })).toBe(true);
  });

  it('writes nothing to a trashed blueprint or channel', async () => {
    const { channelId, blueprintId } = await seed('Trashed writes');
    const blueprints = http.app.get(BlueprintService);
    const draft = exampleScript();
    await call(`/blueprints/${blueprintId}`, 'DELETE');
    // a stale editor tab saving after the blueprint was trashed
    await expect(blueprints.createVersion(blueprintId, draft)).rejects.toThrow(/not found/);
    await expect(blueprints.setWorkingDraft(blueprintId, draft, null)).rejects.toThrow(/not found/);
    await call(`/trash/blueprints/${blueprintId}/restore`, 'POST');
    await expect(blueprints.createVersion(blueprintId, draft)).resolves.toMatchObject({
      blueprintId,
    });

    // a channel in the trash takes no new blueprints, and its blueprints take no writes
    await call(`/channels/${channelId}`, 'DELETE');
    await expect(blueprints.ensureBlueprint(channelId, 'Too late')).rejects.toThrow(/in the trash/);
    await expect(blueprints.createVersion(blueprintId, draft)).rejects.toThrow(/not found/);
    await expect(blueprints.setWorkingDraft(blueprintId, draft, null)).rejects.toThrow(/not found/);
    await call(`/trash/channels/${channelId}/restore`, 'POST');
    await expect(blueprints.ensureBlueprint(channelId, 'In time')).resolves.toEqual(
      expect.any(String),
    );
  });

  it('restores under a name that is free, and keeps the suffix on a long name', async () => {
    const ch = await http.app.get(ChannelService).create('local', {
      name: `Names ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprints = http.app.get(BlueprintService);
    const trashAndReplace = async (name: string) => {
      const id = await blueprints.ensureBlueprint(ch.id, name);
      await call(`/blueprints/${id}`, 'DELETE');
      await blueprints.ensureBlueprint(ch.id, name); // the name is taken meanwhile
      return id;
    };
    const first = await trashAndReplace('Reel');
    const second = await trashAndReplace('Reel');
    expect((await blueprints.restore(first)).name).toBe('Reel (restored)');
    expect((await blueprints.restore(second)).name).toBe('Reel (restored 2)');

    const long = 'x'.repeat(120);
    const third = await trashAndReplace(long);
    const restored = (await blueprints.restore(third)).name;
    expect(restored).toHaveLength(120);
    expect(restored.endsWith(' (restored)')).toBe(true);
  });
});
