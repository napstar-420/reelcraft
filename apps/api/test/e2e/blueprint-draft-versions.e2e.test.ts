import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CreateBlueprintVersionDto, StageDef } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import { buildTestApp, type TestApp } from '../support/build-app';
import { buildHttpTestApp, type HttpTestApp } from '../support/build-http-test-app';
import { createTestDb, type TestDb } from '../support/test-db';

/** Canvas runs of unsaved edits use draft snapshot versions: they never take
 * a version number, never become current, and their runs stay out of the
 * Runs page and run count unless asked for. Only Save creates a version. */
describe('blueprint draft versions (e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;
  let http: HttpTestApp;

  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb);
    http = await buildHttpTestApp(testDb);
  });

  afterAll(async () => {
    try {
      await http?.close();
      await testApp?.close();
    } finally {
      await testDb.teardown();
    }
  });

  function content(template: string): CreateBlueprintVersionDto {
    const stage: StageDef = {
      key: 'draft',
      label: 'Draft',
      capability: 'text.generate',
      config: {},
      slots: {},
      context: {},
      output: { kind: 'text' },
      checks: [],
      retryLimit: 0,
      instructions: { template },
      model: { provider: 'fake', modelId: 'fake-text-1', params: {} },
    } as StageDef;
    return { graph: [stage], inputs: [], roles: [], defaults: {}, budget: { runCapUsd: 5 } };
  }

  async function setup() {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const channel = await channels.create('local', {
      name: `Draft Versions ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Draft Versions Blueprint');
    return { channelId: channel.id, blueprintId, blueprints };
  }

  it('draft snapshots never take a version number or become current; only save advances', async () => {
    const { blueprintId, blueprints } = await setup();
    await blueprints.createVersion(blueprintId, content('v1.0'));
    const v11 = await blueprints.createVersion(blueprintId, content('v1.1'));

    const draftA = await blueprints.createVersion(blueprintId, content('edit a'), {
      draft: true,
    });
    const draftB = await blueprints.createVersion(blueprintId, content('edit b'), {
      draft: true,
    });
    expect(draftA).toMatchObject({ major: 1, minor: 1, draft: true });
    expect(draftB).toMatchObject({ major: 1, minor: 1, draft: true });

    expect((await blueprints.getBlueprint(blueprintId)).currentVersionId).toBe(v11.id);
    const listed = await blueprints.listVersions(blueprintId);
    expect(listed.map((v) => [v.major, v.minor])).toEqual([
      [1, 1],
      [1, 0],
    ]);
    expect(listed.every((v) => !v.draft)).toBe(true);
    // Each listed version carries its real-run count for the Versions menu.
    expect(listed.map((v) => v.runCount)).toEqual([0, 0]);

    const v12 = await blueprints.createVersion(blueprintId, content('v1.2'));
    expect(v12).toMatchObject({ major: 1, minor: 2, draft: false });
    expect((await blueprints.getBlueprint(blueprintId)).currentVersionId).toBe(v12.id);
  });

  it('save bumps minor, "Bump version" bumps major and resets minor', async () => {
    const { blueprintId, blueprints } = await setup();
    const first = await blueprints.createVersion(blueprintId, content('a'), {
      bump: 'major',
    });
    expect(first).toMatchObject({ major: 1, minor: 0 });
    await blueprints.createVersion(blueprintId, content('b'));
    const v2 = await blueprints.createVersion(blueprintId, content('c'), {
      bump: 'major',
    });
    expect(v2).toMatchObject({ major: 2, minor: 0 });
    const v21 = await blueprints.createVersion(blueprintId, content('d'));
    expect(v21).toMatchObject({ major: 2, minor: 1 });
    const draft = await blueprints.createVersion(blueprintId, content('e'), {
      draft: true,
      bump: 'major',
    });
    expect(draft).toMatchObject({ major: 2, minor: 1, draft: true });

    const listed = await blueprints.listVersions(blueprintId);
    expect(listed.map((v) => `${v.major}.${v.minor}`)).toEqual(['2.1', '2.0', '1.1', '1.0']);
  });

  it('keeps the autosaved working copy until the next save clears it', async () => {
    const { blueprintId, blueprints } = await setup();
    await blueprints.createVersion(blueprintId, content('v1'));

    const working = content('unsaved edit');
    const base = (await blueprints.getBlueprint(blueprintId)).currentVersionId;
    await blueprints.setWorkingDraft(blueprintId, working, base);
    expect((await blueprints.getBlueprint(blueprintId)).workingDraft).toEqual(working);

    await blueprints.createVersion(blueprintId, content('unsaved edit'), {
      draft: true,
    });
    expect((await blueprints.getBlueprint(blueprintId)).workingDraft).toEqual(working);

    await blueprints.createVersion(blueprintId, working);
    expect(await blueprints.getBlueprint(blueprintId)).toMatchObject({
      workingDraft: null,
      workingDraftBaseVersionId: null,
    });
  });

  describe('working draft base version', () => {
    const conflict = (currentVersionId: string | null) => ({
      status: 409,
      response: { code: 'blueprint_changed', currentVersionId },
    });

    it('stores the draft with its base while that version is current', async () => {
      const { blueprintId, blueprints } = await setup();
      // No saved version yet: a null base is the current state.
      await blueprints.setWorkingDraft(blueprintId, content('first'), null);
      expect(await blueprints.getBlueprint(blueprintId)).toMatchObject({
        workingDraft: content('first'),
        workingDraftBaseVersionId: null,
      });

      const v1 = await blueprints.createVersion(blueprintId, content('v1'));
      await blueprints.setWorkingDraft(blueprintId, content('edit'), v1.id);
      expect(await blueprints.getBlueprint(blueprintId)).toMatchObject({
        workingDraft: content('edit'),
        workingDraftBaseVersionId: v1.id,
      });
    });

    it('refuses a draft based on a version a newer save replaced, and keeps the stored one', async () => {
      const { blueprintId, blueprints } = await setup();
      const v1 = await blueprints.createVersion(blueprintId, content('v1'));
      await blueprints.setWorkingDraft(blueprintId, content('edit'), v1.id);
      const v2 = await blueprints.createVersion(blueprintId, content('v2'));
      expect((await blueprints.getBlueprint(blueprintId)).workingDraft).toBeNull();

      await expect(
        blueprints.setWorkingDraft(blueprintId, content('stale tab'), v1.id),
      ).rejects.toMatchObject(conflict(v2.id));
      // A tab that loaded before the first save thinks nothing was saved.
      await expect(
        blueprints.setWorkingDraft(blueprintId, content('older tab'), null),
      ).rejects.toMatchObject(conflict(v2.id));
      expect(await blueprints.getBlueprint(blueprintId)).toMatchObject({
        workingDraft: null,
        workingDraftBaseVersionId: null,
      });

      // The other tab's edits survive a stale tab trying to clear them.
      await blueprints.setWorkingDraft(blueprintId, content('other tab'), v2.id);
      await expect(blueprints.setWorkingDraft(blueprintId, null, v1.id)).rejects.toMatchObject(
        conflict(v2.id),
      );
      expect((await blueprints.getBlueprint(blueprintId)).workingDraft).toEqual(
        content('other tab'),
      );

      // Clearing with the right base works and drops the base too.
      await blueprints.setWorkingDraft(blueprintId, null, v2.id);
      expect(await blueprints.getBlueprint(blueprintId)).toMatchObject({
        workingDraft: null,
        workingDraftBaseVersionId: null,
      });
    });

    it('is a 404 for a blueprint that does not exist', async () => {
      const { blueprints } = await setup();
      await expect(blueprints.setWorkingDraft('nope', content('x'), null)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('rejects a PUT without baseVersionId (an old browser bundle) with 400, then 409 when stale', async () => {
      const { blueprintId, blueprints } = await setup();
      const v1 = await blueprints.createVersion(blueprintId, content('v1'));
      const put = (body: unknown) =>
        fetch(`${http.baseUrl}/blueprints/${blueprintId}/working-draft`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

      expect((await put({ workingDraft: content('old bundle') })).status).toBe(400);
      expect((await blueprints.getBlueprint(blueprintId)).workingDraft).toBeNull();

      const ok = await put({ workingDraft: content('edit'), baseVersionId: v1.id });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ workingDraftBaseVersionId: v1.id });

      const v2 = await blueprints.createVersion(blueprintId, content('v2'));
      const stale = await put({ workingDraft: content('stale'), baseVersionId: v1.id });
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({
        code: 'blueprint_changed',
        currentVersionId: v2.id,
      });
    });

    it('refuses a save from a tab that missed a newer one, and saves without a base', async () => {
      const { blueprintId, blueprints } = await setup();
      const v1 = await blueprints.createVersion(blueprintId, content('v1'), {
        expectedCurrent: null,
      });
      const v2 = await blueprints.createVersion(blueprintId, content('v2'), {
        expectedCurrent: v1.id,
      });

      await expect(
        blueprints.createVersion(blueprintId, content('stale'), { expectedCurrent: v1.id }),
      ).rejects.toMatchObject(conflict(v2.id));
      await expect(
        blueprints.createVersion(blueprintId, content('stale'), { expectedCurrent: null }),
      ).rejects.toMatchObject(conflict(v2.id));
      expect((await blueprints.listVersions(blueprintId)).map((v) => v.id)).toEqual([v2.id, v1.id]);

      const v3 = await blueprints.createVersion(blueprintId, content('unchecked'));
      expect(v3).toMatchObject({ major: 1, minor: 2 });
    });

    it('guards POST /versions with ?base= (empty means no saved version yet)', async () => {
      const { blueprintId, blueprints } = await setup();
      const post = (base: string | undefined) =>
        fetch(
          `${http.baseUrl}/blueprints/${blueprintId}/versions${base === undefined ? '' : `?base=${base}`}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(content('x')),
          },
        );

      const first = await post('');
      expect(first.status).toBe(201);
      const v1 = (await first.json()) as { id: string };

      const stale = await post('');
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({
        code: 'blueprint_changed',
        currentVersionId: v1.id,
      });
      expect((await post(v1.id)).status).toBe(201);
      expect((await post(undefined)).status).toBe(201);
      expect(await blueprints.listVersions(blueprintId)).toHaveLength(3);
    });

    it('can keep the draft across a save (package install), still tied to the old base', async () => {
      const { blueprintId, blueprints } = await setup();
      const v1 = await blueprints.createVersion(blueprintId, content('v1'));
      await blueprints.setWorkingDraft(blueprintId, content('edit'), v1.id);

      const v2 = await blueprints.createVersion(blueprintId, content('package'), {
        keepWorkingDraft: true,
      });
      expect(await blueprints.getBlueprint(blueprintId)).toMatchObject({
        currentVersionId: v2.id,
        workingDraft: content('edit'),
        workingDraftBaseVersionId: v1.id,
      });
    });
  });

  it('dry run by version number never resolves to a draft snapshot', async () => {
    const { blueprintId, blueprints } = await setup();
    const runs = testApp.app.get(RunService);
    const v1 = await blueprints.createVersion(blueprintId, content('v1'));
    await blueprints.createVersion(blueprintId, content('edit'), { draft: true });

    const dryRun = await runs.startDryRun(blueprintId, { major: 1, minor: 0 });
    expect(dryRun.blueprintVersionId).toBe(v1.id);
  });

  it('hides draft runs from the run list and run count unless asked, and lets them seed across', async () => {
    const { channelId, blueprintId, blueprints } = await setup();
    const runs = testApp.app.get(RunService);
    const saved = await blueprints.createVersion(blueprintId, content('v1'));
    const snapshot = await blueprints.createVersion(blueprintId, content('edit'), {
      draft: true,
    });

    const base = { channelId, inputs: {}, roleBindings: {}, rerunStageKeys: [], budgetCapUsd: 5 };
    const savedRun = await runs.create({ ...base, blueprintVersionId: saved.id });
    const draftRun = await runs.create({
      ...base,
      blueprintVersionId: snapshot.id,
      seedFromRunId: savedRun.id,
    });

    const listQuery = { blueprintId, includeDryRuns: false, limit: 20, offset: 0 };
    const hidden = await runs.list({ ...listQuery, includeDrafts: false });
    expect(hidden.items.map((r) => r.id)).toEqual([savedRun.id]);
    expect(hidden.total).toBe(1);

    const shown = await runs.list({ ...listQuery, includeDrafts: true });
    expect(shown.items.find((r) => r.id === draftRun.id)).toMatchObject({ draft: true });
    expect(shown.items.find((r) => r.id === savedRun.id)).toMatchObject({ draft: false });

    expect((await blueprints.getBlueprint(blueprintId)).runCount).toBe(1);
  });
});
