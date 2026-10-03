import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { CreateBlueprintDto } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintController } from '../../src/blueprint/blueprint.controller';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

/**
 * `POST /blueprints` creates a blueprint and refuses a name already used in
 * the channel (`BlueprintService.createBlueprint`). This suite proves the controller wiring and DTO
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

  it('refuses a name already used in the channel, naming the existing blueprint', async () => {
    const channel = await makeChannel();
    const controller = testApp.app.get(BlueprintController);

    const first = await controller.create({ channelId: channel.id, name: 'Same Name' });
    const error = await controller
      .create({ channelId: channel.id, name: 'Same Name' })
      .then(() => undefined)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'blueprint_name_taken',
      blueprintId: first.blueprintId,
    });
  });

  it('allows the same name in a different channel', async () => {
    const controller = testApp.app.get(BlueprintController);
    const a = await controller.create({ channelId: (await makeChannel()).id, name: 'Shared' });
    const b = await controller.create({ channelId: (await makeChannel()).id, name: 'Shared' });
    expect(b.blueprintId).not.toBe(a.blueprintId);
  });

  it('refuses renaming onto another blueprint in the channel', async () => {
    const channel = await makeChannel();
    const controller = testApp.app.get(BlueprintController);
    await controller.create({ channelId: channel.id, name: 'Taken' });
    const other = await controller.create({ channelId: channel.id, name: 'Other' });
    const blueprints = testApp.app.get(BlueprintService);

    await expect(blueprints.update(other.blueprintId, { name: 'Taken' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(blueprints.update(other.blueprintId, { name: 'Other' })).resolves.toMatchObject({
      name: 'Other',
    });
  });

  it('rejects an empty name via the DTO', () => {
    const result = CreateBlueprintDto.safeParse({ channelId: 'some-channel', name: '' });
    expect(result.success).toBe(false);
  });
});
