import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StageDef } from '@reefcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { RunService } from '../../src/run/run.service';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

function textStage(overrides: Partial<StageDef> = {}): StageDef {
  return {
    key: 'outline',
    label: 'Outline',
    capability: 'llm.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    retryLimit: 0,
    ...overrides,
  };
}

/**
 * §16.5 — `blueprint-validator.service.ts` can only WARN about a missing
 * `max_tokens` at save time (it can't see the channel layer, where
 * `max_tokens` usually lives). `RunService.create()` is where the full
 * layer stack has actually resolved, so an unbounded text reservation
 * becomes a hard error there instead — `estimateCost`/`reserve` (§11)
 * can't produce an honest ceiling without it.
 */
describe('RunService.create budget preconditions (e2e)', () => {
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

  async function createVersion(graph: StageDef[], channelDefaults: Record<string, unknown> = {}) {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);

    const channel = await channels.create('local', {
      name: `Run Service Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: channelDefaults,
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Run Service Blueprint');
    const version = await blueprints.createVersion(blueprintId, {
      graph,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    return { channel, version };
  }

  it('throws, naming the stage, when a text stage has no effective max_tokens anywhere in the layer stack', async () => {
    const runs = testApp.app.get(RunService);
    const { channel, version } = await createVersion([
      textStage({ model: { provider: 'fake', modelId: 'fake-text-1', params: {} } }),
    ]);

    await expect(
      runs.create({
        channelId: channel.id,
        blueprintVersionId: version.id,
        inputs: {},
        roleBindings: {},
        budgetCapUsd: 10,
      }),
    ).rejects.toThrow(/"outline".*max_tokens/);
  });

  it('succeeds when max_tokens is set on the channel layer, not just the stage', async () => {
    const runs = testApp.app.get(RunService);
    const { channel, version } = await createVersion(
      [textStage({ model: { provider: 'fake', modelId: 'fake-text-1', params: {} } })],
      { model: { params: { max_tokens: 256 } } },
    );

    await expect(
      runs.create({
        channelId: channel.id,
        blueprintVersionId: version.id,
        inputs: {},
        roleBindings: {},
        budgetCapUsd: 10,
      }),
    ).resolves.toBeDefined();
  });

  it('does not require max_tokens for a non-text capability', async () => {
    const runs = testApp.app.get(RunService);
    const { channel, version } = await createVersion([
      {
        key: 'publish',
        label: 'Publish',
        capability: 'publish.stub',
        config: {},
        slots: {},
        context: {},
        output: { kind: 'data', schema: { type: 'object' } },
        checks: [],
        retryLimit: 0,
      },
    ]);

    await expect(
      runs.create({
        channelId: channel.id,
        blueprintVersionId: version.id,
        inputs: {},
        roleBindings: {},
        budgetCapUsd: 10,
      }),
    ).resolves.toBeDefined();
  });
});
