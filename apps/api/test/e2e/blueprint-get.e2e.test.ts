import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintController } from '../../src/blueprint/blueprint.controller';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

/**
 * Chunk 3 (Phase 9.5) — `GET /blueprints/:id` is a thin wrapper around the
 * new `BlueprintService.getBlueprint`, added because the canvas's binding
 * picker needs a blueprint's `channelId` from just a `blueprintId` (to scope
 * the asset picker) and no existing endpoint exposed it. Mirrors
 * `blueprint-create.e2e.test.ts`'s style of driving the controller directly.
 */
describe('BlueprintController.getBlueprint (e2e)', () => {
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

  async function makeChannel() {
    const channels = testApp.app.get(ChannelService);
    return channels.create('local', {
      name: `Get-blueprint Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
  }

  it('returns the blueprint row, including its channelId and name', async () => {
    const channel = await makeChannel();
    const controller = testApp.app.get(BlueprintController);
    const { blueprintId } = await controller.create({
      channelId: channel.id,
      name: 'My Blueprint',
    });

    const result = await controller.getBlueprint(blueprintId);

    expect(result.id).toBe(blueprintId);
    expect(result.channelId).toBe(channel.id);
    expect(result.name).toBe('My Blueprint');
  });

  it('throws for a nonexistent id', async () => {
    const controller = testApp.app.get(BlueprintController);

    await expect(controller.getBlueprint('not-a-real-id')).rejects.toThrow(
      'Blueprint not-a-real-id not found',
    );
  });
});
