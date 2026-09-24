import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CreateBlueprintDto } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintController } from '../../src/blueprint/blueprint.controller';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

/**
 * Chunk 1 — `POST /blueprints` is a thin wrapper around
 * `BlueprintService.ensureBlueprint`, which is already idempotent by
 * `(channelId, name)`. This suite proves the controller wiring and DTO
 * validation, mirroring `blueprint-validate.e2e.test.ts`'s style of driving
 * the controller/service directly rather than over HTTP (no e2e test in
 * this repo goes through `supertest`).
 */
describe('BlueprintController.create (e2e)', () => {
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
      name: `Create-blueprint Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
  }

  it('creates a blueprint and returns a blueprintId', async () => {
    const channel = await makeChannel();
    const controller = testApp.app.get(BlueprintController);

    const result = await controller.create({ channelId: channel.id, name: 'My Blueprint' });

    expect(typeof result.blueprintId).toBe('string');
    expect(result.blueprintId.length).toBeGreaterThan(0);
  });

  it('is idempotent by (channelId, name)', async () => {
    const channel = await makeChannel();
    const controller = testApp.app.get(BlueprintController);

    const first = await controller.create({ channelId: channel.id, name: 'Same Name' });
    const second = await controller.create({ channelId: channel.id, name: 'Same Name' });

    expect(second.blueprintId).toBe(first.blueprintId);
  });

  it('rejects an empty name via the DTO', () => {
    const result = CreateBlueprintDto.safeParse({ channelId: 'some-channel', name: '' });
    expect(result.success).toBe(false);
  });
});
