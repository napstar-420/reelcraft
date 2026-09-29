import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StageDef } from '@reelcraft/shared';
import { ulid } from '../../src/common/ulid';
import { artifact, blueprintVersion, run } from '../../src/db/schema/index';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintController } from '../../src/blueprint/blueprint.controller';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

function stage(key: string, capability = 'text.generate'): StageDef {
  return {
    key,
    label: key,
    capability,
    config: {},
    slots: {},
    context: {},
    output: { kind: capability === 'timeline.render' ? 'media.video' : 'text' },
    checks: [],
    retryLimit: 0,
  };
}

/**
 * A4 — `runCount` and `latestPosterBlobId` on `listByChannel`/`getBlueprint`,
 * computed in one query (no N+1). Seeds runs/artifacts by hand, same
 * convention as `final-video.e2e.test.ts`, since driving real completed
 * runs through the orchestration pipeline isn't needed to prove the query.
 */
describe('blueprint list run stats (e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;

  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb);
  });

  afterAll(async () => {
    await testApp?.close();
    await testDb?.teardown();
  });

  async function makeVersion(blueprintId: string) {
    const versionId = ulid();
    await testDb.db.insert(blueprintVersion).values({
      id: versionId,
      blueprintId,
      major: 1,
      minor: 0,
      graph: [stage('assemble', 'timeline.render')],
      defaults: {},
      budget: { runCapUsd: 10 },
      validation: [],
      runnable: true,
    });
    return versionId;
  }

  async function seedRun(
    versionId: string,
    channelId: string,
    options: { dryRun?: boolean; state?: 'COMPLETED' | 'RUNNING'; posterBlobId?: string },
  ) {
    const runId = ulid();
    await testDb.db.insert(run).values({
      id: runId,
      channelId,
      blueprintVersionId: versionId,
      state: options.state ?? 'COMPLETED',
      dryRun: options.dryRun ?? false,
      inputs: {},
      resolvedConfig: {},
      budgetCapUsd: '10.0000',
      endedAt: new Date().toISOString(),
    });
    if (options.posterBlobId) {
      await testDb.db.insert(artifact).values({
        id: ulid(),
        runId,
        producerStageKey: 'assemble',
        kind: 'media.video',
        stale: false,
        reproLevel: 'exact',
        derived: { poster: options.posterBlobId },
      });
    }
    return runId;
  }

  it("counts only non-dry runs and reports the latest completed run's poster", async () => {
    const channels = testApp.app.get(ChannelService);
    const controller = testApp.app.get(BlueprintController);
    const testChannel = await channels.create('local', {
      name: `Blueprint List Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const { blueprintId } = await controller.create({
      channelId: testChannel.id,
      name: 'Stats Blueprint',
    });
    const versionId = await makeVersion(blueprintId);

    await seedRun(versionId, testChannel.id, { dryRun: true, posterBlobId: 'poster-dry' });
    await seedRun(versionId, testChannel.id, { posterBlobId: 'poster-1' });
    // Second real, non-dry run — inserted later so it's the "latest" by
    // endedAt (each seedRun call sets endedAt to the current time).
    await new Promise((resolve) => setTimeout(resolve, 5));
    await seedRun(versionId, testChannel.id, { posterBlobId: 'poster-2' });

    const [listed] = await controller.list(testChannel.id);
    expect(listed?.runCount).toBe(2); // dry run excluded
    expect(listed?.latestPosterBlobId).toBe('poster-2');

    const fetched = await controller.getBlueprint(blueprintId);
    expect(fetched.runCount).toBe(2);
    expect(fetched.latestPosterBlobId).toBe('poster-2');
  });

  it('reports zero runs and a null poster for a fresh blueprint', async () => {
    const channels = testApp.app.get(ChannelService);
    const controller = testApp.app.get(BlueprintController);
    const testChannel = await channels.create('local', {
      name: `Blueprint List Empty Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const { blueprintId } = await controller.create({
      channelId: testChannel.id,
      name: 'Empty Blueprint',
    });

    const [listed] = await controller.list(testChannel.id);
    expect(listed?.runCount).toBe(0);
    expect(listed?.latestPosterBlobId).toBeNull();

    const fetched = await controller.getBlueprint(blueprintId);
    expect(fetched.runCount).toBe(0);
    expect(fetched.latestPosterBlobId).toBeNull();
  });

  it('does not use a poster from a run that has not completed', async () => {
    const channels = testApp.app.get(ChannelService);
    const controller = testApp.app.get(BlueprintController);
    const testChannel = await channels.create('local', {
      name: `Blueprint List Running Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const { blueprintId } = await controller.create({
      channelId: testChannel.id,
      name: 'Running Blueprint',
    });
    const versionId = await makeVersion(blueprintId);
    await seedRun(versionId, testChannel.id, { state: 'RUNNING', posterBlobId: 'should-not-show' });

    const fetched = await controller.getBlueprint(blueprintId);
    expect(fetched.runCount).toBe(1);
    expect(fetched.latestPosterBlobId).toBeNull();
  });
});
