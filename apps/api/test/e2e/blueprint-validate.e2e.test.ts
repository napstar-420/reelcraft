import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { StageDef } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { blueprintVersion } from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

/**
 * Chunk 3 — `POST /blueprints/:id/validate` reuses `createVersion`'s own
 * pre-persist validation (`BlueprintService.computeValidation`) via a new
 * `validateOnly`. This suite proves the two paths compute identically and
 * that `validateOnly` never writes a `blueprint_version` row.
 */
describe('BlueprintService.validateOnly (e2e)', () => {
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

  const VALID_GRAPH: StageDef[] = [
    {
      key: 'outline',
      label: 'Outline',
      capability: 'text.generate',
      config: {},
      slots: {},
      context: {},
      output: { kind: 'text' },
      checks: [],
      retryLimit: 0,
    },
  ];

  const INVALID_GRAPH: StageDef[] = [
    {
      key: 'outline',
      label: 'Outline',
      capability: 'not.a.real.capability',
      config: {},
      slots: {},
      context: {},
      output: { kind: 'text' },
      checks: [],
      retryLimit: 0,
    },
  ];

  async function setup() {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const channel = await channels.create('local', {
      name: `Validate-only Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Validate-only Blueprint');
    return { blueprints, blueprintId };
  }

  async function versionCount(blueprintId: string): Promise<number> {
    const rows = await testDb.db
      .select({ id: blueprintVersion.id })
      .from(blueprintVersion)
      .where(eq(blueprintVersion.blueprintId, blueprintId));
    return rows.length;
  }

  it('returns identical issues/runnable to createVersion for a valid graph, and writes nothing', async () => {
    const { blueprints, blueprintId } = await setup();
    const dto = {
      graph: VALID_GRAPH,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    };

    const before = await versionCount(blueprintId);
    const validated = await blueprints.validateOnly(blueprintId, dto);
    expect(await versionCount(blueprintId)).toBe(before);

    const created = await blueprints.createVersion(blueprintId, dto);
    expect(validated.issues).toEqual(created.validation);
    expect(validated.runnable).toBe(created.runnable);
    expect(validated.runnable).toBe(true);
  });

  it('surfaces the same errors as createVersion for an invalid graph, and still writes nothing', async () => {
    const { blueprints, blueprintId } = await setup();
    const dto = {
      graph: INVALID_GRAPH,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    };

    const before = await versionCount(blueprintId);
    const validated = await blueprints.validateOnly(blueprintId, dto);
    expect(validated.runnable).toBe(false);
    expect(validated.issues.some((issue) => issue.severity === 'error')).toBe(true);
    expect(await versionCount(blueprintId)).toBe(before);

    const created = await blueprints.createVersion(blueprintId, dto);
    expect(validated.issues).toEqual(created.validation);
    expect(validated.runnable).toBe(created.runnable);
  });

  it('refuses Include transcript when the judge cannot listen and no Deepgram key is set', async () => {
    const { blueprints, blueprintId } = await setup();
    const speech: StageDef = {
      key: 'voice',
      label: 'Voice',
      capability: 'audio.speech',
      config: {},
      slots: { text: { from: 'const', value: 'hello there' } },
      context: {},
      output: { kind: 'media.audio' },
      checks: [],
      retryLimit: 0,
      model: { provider: 'fake', modelId: 'fake-audio-1', params: {} },
      qc: {
        criteria: 'Clear and friendly',
        threshold: 70,
        includeInputs: false,
        media: { includeTranscript: true },
        model: { provider: 'fake', modelId: 'fake-text-1', params: {} },
      },
    };
    const result = await blueprints.validateOnly(blueprintId, {
      graph: [speech],
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 5 },
    });
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        path: 'stages.voice.qc.media.includeTranscript',
        message: expect.stringMatching(/can't listen to audio and no Deepgram key/),
        severity: 'error',
      }),
    );
  });

  it('throws for a nonexistent blueprint id', async () => {
    const blueprints = testApp.app.get(BlueprintService);
    await expect(
      blueprints.validateOnly('not-a-real-blueprint-id', {
        graph: VALID_GRAPH,
        inputs: [],
        roles: [],
        defaults: {},
        budget: { runCapUsd: 10 },
      }),
    ).rejects.toThrow();
  });
});
