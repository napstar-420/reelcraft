import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InngestTestEngine } from '@inngest/test';
import { eq } from 'drizzle-orm';
import type { StageDef } from '@reelcraft/shared';
import { ChannelService } from '../../src/channel/channel.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { CharacterService } from '../../src/channel/character.service';
import { AssetService } from '../../src/channel/asset.service';
import { RunService } from '../../src/run/run.service';
import { STORAGE_ADAPTER, type StorageAdapter } from '../../src/storage/storage.adapter';
import type { StageExecuteEventData } from '../../src/orchestration/functions/stage-execute.fn';
import {
  artifact,
  asset,
  blob,
  blueprint,
  blueprintVersion,
  character,
  ledgerEntry,
  run,
  stageAttempt,
  stageEvent,
  stageExecution,
} from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

/**
 * Proves `ChannelService.delete()`'s hardcoded cascade (see the doc comment
 * on that method) actually removes every table it claims to, in the correct
 * order — a wrong order throws a live FK violation instead of leaving
 * orphans, so this has to run against real Postgres, not mocks. Builds one
 * channel with a blueprint/version, a channel-scoped character, a
 * channel-scoped asset, and a run driven to COMPLETED through the real
 * Inngest pipeline (same technique as dry-run.e2e.test.ts) so every
 * dependent table (stage_execution, stage_attempt, artifact, ledger_entry,
 * blob) has real rows to delete.
 */
describe('channel delete cascade (e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;
  let runOrchestrateFn: TestApp['functions'][number];
  let stageExecuteFn: TestApp['functions'][number];

  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb);
    const orchestrateFn = testApp.functions.find((f) => f.id() === 'run.orchestrate');
    const executeFn = testApp.functions.find((f) => f.id() === 'stage.execute');
    if (!orchestrateFn || !executeFn) throw new Error('Inngest functions not found');
    runOrchestrateFn = orchestrateFn;
    stageExecuteFn = executeFn;
  });

  afterAll(async () => {
    try {
      await testApp?.close();
    } finally {
      await testDb.teardown();
    }
  });

  const GRAPH: StageDef[] = [
    {
      key: 'draft',
      label: 'Draft',
      capability: 'text.generate',
      config: {},
      slots: {},
      context: {},
      output: { kind: 'text' },
      checks: [],
      retryLimit: 0,
      model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 256 } },
    },
  ];

  async function runThroughRealPipeline(
    runId: string,
    executions: Array<{ id: string; stageKey: string }>,
  ) {
    const invokeSteps = executions.map((execution) => ({
      id: `invoke-stage-${execution.stageKey}`,
      handler: async () => {
        const data: StageExecuteEventData = {
          runId,
          stageExecutionId: execution.id,
          stageKey: execution.stageKey,
        };
        const inner = new InngestTestEngine({
          function: stageExecuteFn,
          events: [{ name: 'stage/execute.requested', data }],
        });
        const { result, error } = await inner.execute();
        if (error) throw error;
        return result;
      },
    }));

    const outerEngine = new InngestTestEngine({
      function: runOrchestrateFn,
      events: [{ name: 'run/started', data: { runId } }],
      steps: invokeSteps,
    });
    return outerEngine.execute();
  }

  it('removes the channel and every dependent row across the full FK graph', async () => {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const characters = testApp.app.get(CharacterService);
    const assets = testApp.app.get(AssetService);
    const runs = testApp.app.get(RunService);
    const storage = testApp.app.get<StorageAdapter>(STORAGE_ADAPTER);

    const channel = await channels.create('local', {
      name: `Delete Cascade Channel ${Date.now()}-${Math.random()}`,
      theme: {},
      defaults: {},
    });

    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Delete Cascade Blueprint');
    const version = await blueprints.createVersion(blueprintId, {
      graph: GRAPH,
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    expect(version.runnable).toBe(true);

    const createdCharacter = await characters.create(channel.id, {
      name: 'Cascade Character',
      description: 'Exists only to prove delete cascades to it',
    });

    const upload = await assets.requestUpload(channel.id, 'png');
    await storage.put(upload.objectKey, Buffer.from('fake-png-bytes'), { mime: 'image/png' });
    const createdAsset = await assets.create(channel.id, {
      name: `cascade-asset-${Date.now()}`,
      kind: 'media.image',
      blobId: upload.blobId,
      objectKey: upload.objectKey,
      sha256: 'deadbeef',
      tags: [],
    });

    const dryRun = await runs.startDryRun(blueprintId, version);
    const { error } = await runThroughRealPipeline(dryRun.id, dryRun.stageExecutions);
    expect(error).toBeUndefined();

    const [completedRun] = await testDb.db.select().from(run).where(eq(run.id, dryRun.id));
    expect(completedRun?.state).toBe('COMPLETED');
    expect(completedRun?.endedAt).not.toBeNull();

    const executionsBefore = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.runId, dryRun.id));
    expect(executionsBefore.length).toBeGreaterThan(0);
    const attemptsBefore = await testDb.db
      .select()
      .from(stageAttempt)
      .where(eq(stageAttempt.stageExecutionId, executionsBefore[0]!.id));
    expect(attemptsBefore.length).toBeGreaterThan(0);
    const artifactsBefore = await testDb.db
      .select()
      .from(artifact)
      .where(eq(artifact.runId, dryRun.id));
    expect(artifactsBefore.length).toBeGreaterThan(0);
    const ledgerBefore = await testDb.db
      .select()
      .from(ledgerEntry)
      .where(eq(ledgerEntry.runId, dryRun.id));
    expect(ledgerBefore.length).toBeGreaterThan(0);
    const eventsBefore = await testDb.db
      .select()
      .from(stageEvent)
      .where(eq(stageEvent.runId, dryRun.id));
    expect(eventsBefore.length).toBeGreaterThan(0);
    const assetBlobBefore = await testDb.db
      .select()
      .from(blob)
      .where(eq(blob.id, createdAsset.blobId));
    expect(assetBlobBefore).toHaveLength(1);

    await channels.delete(channel.id);

    await expect(channels.get(channel.id)).rejects.toThrow();

    const [blueprintRowAfter] = await testDb.db
      .select()
      .from(blueprint)
      .where(eq(blueprint.id, blueprintId));
    expect(blueprintRowAfter).toBeUndefined();
    const versionsAfter = await testDb.db
      .select()
      .from(blueprintVersion)
      .where(eq(blueprintVersion.blueprintId, blueprintId));
    expect(versionsAfter).toHaveLength(0);
    const [runRowAfter] = await testDb.db.select().from(run).where(eq(run.id, dryRun.id));
    expect(runRowAfter).toBeUndefined();
    const executionsAfter = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.runId, dryRun.id));
    expect(executionsAfter).toHaveLength(0);
    const attemptsAfter = await testDb.db
      .select()
      .from(stageAttempt)
      .where(eq(stageAttempt.stageExecutionId, executionsBefore[0]!.id));
    expect(attemptsAfter).toHaveLength(0);
    const artifactsAfter = await testDb.db
      .select()
      .from(artifact)
      .where(eq(artifact.runId, dryRun.id));
    expect(artifactsAfter).toHaveLength(0);
    const ledgerAfter = await testDb.db
      .select()
      .from(ledgerEntry)
      .where(eq(ledgerEntry.runId, dryRun.id));
    expect(ledgerAfter).toHaveLength(0);
    const eventsAfter = await testDb.db
      .select()
      .from(stageEvent)
      .where(eq(stageEvent.runId, dryRun.id));
    expect(eventsAfter).toHaveLength(0);
    const [characterRowAfter] = await testDb.db
      .select()
      .from(character)
      .where(eq(character.id, createdCharacter.id));
    expect(characterRowAfter).toBeUndefined();
    const [assetRowAfter] = await testDb.db
      .select()
      .from(asset)
      .where(eq(asset.id, createdAsset.id));
    expect(assetRowAfter).toBeUndefined();
    const assetBlobAfter = await testDb.db
      .select()
      .from(blob)
      .where(eq(blob.id, createdAsset.blobId));
    expect(assetBlobAfter).toHaveLength(0);
  });
});
