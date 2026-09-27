import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { UpdateBlueprintDto } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintController } from '../../src/blueprint/blueprint.controller';
import { ZodValidationPipe } from '../../src/common/zod-validation.pipe';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

/**
 * A2 — `PATCH /blueprints/:id`, following `blueprint-create.e2e.test.ts`'s
 * convention of driving the controller directly rather than over HTTP (no
 * e2e test in this repo goes through `supertest`).
 */
describe('BlueprintController.update (e2e)', () => {
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
      name: `Update-blueprint Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
  }

  it('updates name, description, and tags and leaves the rest unchanged', async () => {
    const channel = await makeChannel();
    const controller = testApp.app.get(BlueprintController);
    const { blueprintId } = await controller.create({ channelId: channel.id, name: 'Original' });

    const updated = await controller.update(blueprintId, {
      name: 'Renamed Blueprint',
      description: 'A refreshed description',
      tags: ['news', 'daily'],
    });
    expect(updated.name).toBe('Renamed Blueprint');
    expect(updated.description).toBe('A refreshed description');
    expect(updated.tags).toEqual(['news', 'daily']);
    expect(updated.channelId).toBe(channel.id);

    const partial = await controller.update(blueprintId, { name: 'Renamed Again' });
    expect(partial.name).toBe('Renamed Again');
    expect(partial.description).toBe('A refreshed description');
    expect(partial.tags).toEqual(['news', 'daily']);
  });

  it('the ZodValidationPipe rejects more than 20 tags with a 400', () => {
    const pipe = new ZodValidationPipe(UpdateBlueprintDto);
    expect(() =>
      pipe.transform({ tags: Array.from({ length: 21 }, (_, i) => `tag-${i}`) }),
    ).toThrow(BadRequestException);
  });
});
