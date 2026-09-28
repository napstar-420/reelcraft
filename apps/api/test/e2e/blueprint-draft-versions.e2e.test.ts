import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CreateBlueprintVersionDto, StageDef } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

/** Canvas runs of unsaved edits use draft snapshot versions: they never take
 * a version number, never become current, and their runs stay out of the
 * Runs page and run count unless asked for. Only Save creates a version. */
describe('blueprint draft versions (e2e)', () => {
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

    const draftA = await blueprints.createVersion(blueprintId, content('edit a'), undefined, {
      draft: true,
    });
    const draftB = await blueprints.createVersion(blueprintId, content('edit b'), undefined, {
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

    const v12 = await blueprints.createVersion(blueprintId, content('v1.2'));
    expect(v12).toMatchObject({ major: 1, minor: 2, draft: false });
    expect((await blueprints.getBlueprint(blueprintId)).currentVersionId).toBe(v12.id);
  });

  it('save bumps minor, "Bump version" bumps major and resets minor', async () => {
    const { blueprintId, blueprints } = await setup();
    const first = await blueprints.createVersion(blueprintId, content('a'), undefined, {
      bump: 'major',
    });
    expect(first).toMatchObject({ major: 1, minor: 0 });
    await blueprints.createVersion(blueprintId, content('b'));
    const v2 = await blueprints.createVersion(blueprintId, content('c'), undefined, {
      bump: 'major',
    });
    expect(v2).toMatchObject({ major: 2, minor: 0 });
    const v21 = await blueprints.createVersion(blueprintId, content('d'));
    expect(v21).toMatchObject({ major: 2, minor: 1 });
    const draft = await blueprints.createVersion(blueprintId, content('e'), undefined, {
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
    await blueprints.setWorkingDraft(blueprintId, working);
    expect((await blueprints.getBlueprint(blueprintId)).workingDraft).toEqual(working);

    await blueprints.createVersion(blueprintId, content('unsaved edit'), undefined, {
      draft: true,
    });
    expect((await blueprints.getBlueprint(blueprintId)).workingDraft).toEqual(working);

    await blueprints.createVersion(blueprintId, working);
    expect((await blueprints.getBlueprint(blueprintId)).workingDraft).toBeNull();
  });

  it('dry run by version number never resolves to a draft snapshot', async () => {
    const { blueprintId, blueprints } = await setup();
    const runs = testApp.app.get(RunService);
    const v1 = await blueprints.createVersion(blueprintId, content('v1'));
    await blueprints.createVersion(blueprintId, content('edit'), undefined, { draft: true });

    const dryRun = await runs.startDryRun(blueprintId, { major: 1, minor: 0 });
    expect(dryRun.blueprintVersionId).toBe(v1.id);
  });

  it('hides draft runs from the run list and run count unless asked, and lets them seed across', async () => {
    const { channelId, blueprintId, blueprints } = await setup();
    const runs = testApp.app.get(RunService);
    const saved = await blueprints.createVersion(blueprintId, content('v1'));
    const snapshot = await blueprints.createVersion(blueprintId, content('edit'), undefined, {
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
