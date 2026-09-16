import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StageDef } from '@reefcraft/shared';
import { ConfigResolverService } from '../../src/run-config/config-resolver.service';
import { ulid } from '../../src/common/ulid';
import { blueprint, blueprintVersion, channel, run } from '../../src/db/schema/index';
import { createTestDb, type TestDb } from '../support/test-db';

function textStage(overrides: Partial<StageDef> = {}): StageDef {
  return {
    key: 'outline',
    label: 'outline',
    capability: 'llm.generate',
    config: { temperature: 0.2 },
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    retryLimit: 0,
    ...overrides,
  };
}

/**
 * DB-backed coverage for `ConfigResolverService.effectiveStageConfig` — the
 * actual per-stage config read path production code uses (`resolveRunConfig`
 * is already covered, pure, by config-resolver.test.ts).
 */
describe('ConfigResolverService.effectiveStageConfig (e2e)', () => {
  let testDb: TestDb;
  let resolver: ConfigResolverService;
  let channelId: string;
  let versionId: string;

  beforeAll(async () => {
    testDb = await createTestDb();
    const db = testDb.db;
    resolver = new ConfigResolverService(db);

    channelId = ulid();
    await db.insert(channel).values({ id: channelId, ownerId: 'local', name: 'Test Channel' });

    const blueprintId = ulid();
    await db.insert(blueprint).values({ id: blueprintId, channelId, name: 'Test Blueprint' });

    versionId = ulid();
    await db.insert(blueprintVersion).values({
      id: versionId,
      blueprintId,
      version: 1,
      graph: [],
      defaults: {},
      budget: { runCapUsd: 10 },
      validation: [],
      runnable: true,
    });
  });

  afterAll(async () => {
    await testDb.teardown();
  });

  async function seedRun(resolvedConfig: unknown, overrides: unknown = {}) {
    const runId = ulid();
    await testDb.db.insert(run).values({
      id: runId,
      channelId,
      blueprintVersionId: versionId,
      state: 'RUNNING',
      inputs: {},
      resolvedConfig,
      overrides,
      budgetCapUsd: '10.0000',
    });
    return runId;
  }

  it('merges run.resolved_config[stageKey] with run.overrides[stageKey] and fills defaults', async () => {
    const runId = await seedRun({
      outline: {
        retryLimit: 1,
        model: { provider: 'fake', modelId: 'fake-text-1', params: { temperature: 0.5 } },
      },
    });

    const effective = await resolver.effectiveStageConfig(runId, 'outline', textStage());

    expect(effective.retryLimit).toBe(1);
    expect(effective.model).toEqual({
      provider: 'fake',
      modelId: 'fake-text-1',
      params: { temperature: 0.5 },
    });
    expect(effective.polling).toEqual({ intervalSec: 5, maxWaitSec: 120 });
    expect(effective.capabilityConfig).toEqual({ temperature: 0.2 });
  });

  it('a run override wins over the base resolved config for that stage', async () => {
    const runId = await seedRun({ outline: { retryLimit: 1 } }, { outline: { retryLimit: 9 } });

    const effective = await resolver.effectiveStageConfig(runId, 'outline', textStage());

    expect(effective.retryLimit).toBe(9);
  });

  it('falls back to the StageDef retryLimit when no layer set one', async () => {
    const runId = await seedRun({ outline: {} });

    const effective = await resolver.effectiveStageConfig(
      runId,
      'outline',
      textStage({ retryLimit: 4 }),
    );

    expect(effective.retryLimit).toBe(4);
  });

  it('throws rather than silently resolving to {} when resolved_config is not stage-keyed', async () => {
    // The pre-chunk-2 shape: a single flat ConfigLayer, not a per-stage map.
    const runId = await seedRun({ retryLimit: 1, model: { provider: 'fake', modelId: 'x' } });

    await expect(resolver.effectiveStageConfig(runId, 'outline', textStage())).rejects.toThrow();
  });

  it('throws when a resolved model pin sets provider without modelId', async () => {
    const runId = await seedRun({ outline: { model: { provider: 'fake' } } });

    await expect(resolver.effectiveStageConfig(runId, 'outline', textStage())).rejects.toThrow(
      'missing "modelId"',
    );
  });
});
