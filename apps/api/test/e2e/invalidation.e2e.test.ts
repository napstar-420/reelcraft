import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { StageDef } from '@reefcraft/shared';
import { MemoryService } from '../../src/artifact/memory.service';
import { ulid } from '../../src/common/ulid';
import {
  artifact,
  blob,
  blueprint,
  blueprintVersion,
  channel,
  ledgerEntry,
  run,
  runMemory,
  stageAttempt,
  stageExecution,
} from '../../src/db/schema/index';
import { InvalidationService } from '../../src/run/invalidation.service';
import { createTestDb, type TestDb } from '../support/test-db';

function stage(key: string): StageDef {
  return {
    key,
    label: key,
    capability: 'llm.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    retryLimit: 0,
  };
}

describe('InvalidationService (e2e)', () => {
  let testDb: TestDb;
  let service: InvalidationService;
  let runId: string;
  let ids: Record<string, string>;

  beforeAll(async () => {
    testDb = await createTestDb();
    service = new InvalidationService(testDb.db, new MemoryService());

    const channelId = ulid();
    await testDb.db.insert(channel).values({ id: channelId, ownerId: 'local', name: 'Channel' });
    const blueprintId = ulid();
    await testDb.db.insert(blueprint).values({ id: blueprintId, channelId, name: 'Blueprint' });
    const versionId = ulid();
    const graph = ['source', 'dependent', 'inputReader', 'unrelated'].map(stage);
    await testDb.db.insert(blueprintVersion).values({
      id: versionId,
      blueprintId,
      version: 1,
      graph,
      defaults: {},
      budget: { runCapUsd: 10 },
      validation: [],
      runnable: true,
    });

    runId = ulid();
    await testDb.db.insert(run).values({
      id: runId,
      channelId,
      blueprintVersionId: versionId,
      state: 'COMPLETED',
      inputs: { prompt: 'reef' },
      resolvedConfig: {},
      budgetCapUsd: '10.0000',
    });

    ids = {
      sourceArtifact: ulid(),
      dependentArtifact: ulid(),
      inputReaderArtifact: ulid(),
      unrelatedArtifact: ulid(),
      inputArtifact: ulid(),
      sourceExecution: ulid(),
      dependentExecution: ulid(),
      inputReaderExecution: ulid(),
      unrelatedExecution: ulid(),
      sourceAttempt: ulid(),
      dependentAttempt: ulid(),
      inputReaderAttempt: ulid(),
      unrelatedAttempt: ulid(),
      dependentBlob: ulid(),
      unrelatedBlob: ulid(),
      inputBlob: ulid(),
    };

    await testDb.db.insert(blob).values([
      {
        id: ids.dependentBlob!,
        scope: 'run',
        runId,
        bucket: 'test',
        objectKey: 'dependent.mp4',
        mime: 'video/mp4',
        bytes: 10,
        sha256: 'dependent',
      },
      {
        id: ids.unrelatedBlob!,
        scope: 'run',
        runId,
        bucket: 'test',
        objectKey: 'unrelated.png',
        mime: 'image/png',
        bytes: 10,
        sha256: 'unrelated',
      },
      {
        id: ids.inputBlob!,
        scope: 'input',
        runId,
        bucket: 'test',
        objectKey: 'input.png',
        mime: 'image/png',
        bytes: 10,
        sha256: 'input',
      },
    ]);

    await testDb.db.insert(artifact).values([
      {
        id: ids.sourceArtifact!,
        runId,
        producerStageKey: 'source',
        kind: 'text',
        data: { text: 'source' },
        stale: false,
        reproLevel: 'exact',
        costUsd: '1.2500',
      },
      {
        id: ids.dependentArtifact!,
        runId,
        producerStageKey: 'dependent',
        kind: 'media.video',
        blobId: ids.dependentBlob!,
        stale: false,
        reproLevel: 'exact',
        costUsd: '0.5000',
      },
      {
        id: ids.inputReaderArtifact!,
        runId,
        producerStageKey: 'inputReader',
        kind: 'text',
        data: { text: 'reader' },
        stale: false,
        reproLevel: 'exact',
        costUsd: '0.2000',
      },
      {
        id: ids.unrelatedArtifact!,
        runId,
        producerStageKey: 'unrelated',
        kind: 'media.image',
        blobId: ids.unrelatedBlob!,
        stale: false,
        reproLevel: 'exact',
        costUsd: '0.7500',
      },
      {
        id: ids.inputArtifact!,
        runId,
        producerStageKey: '$input:prompt',
        kind: 'media.image',
        blobId: ids.inputBlob!,
        stale: false,
        userAuthored: true,
        reproLevel: 'exact',
        costUsd: '0.0000',
      },
    ]);

    await testDb.db.insert(stageExecution).values([
      {
        id: ids.sourceExecution!,
        runId,
        stageKey: 'source',
        state: 'passed',
        outputArtifactId: ids.sourceArtifact!,
        generation: 2,
      },
      {
        id: ids.dependentExecution!,
        runId,
        stageKey: 'dependent',
        state: 'passed',
        outputArtifactId: ids.dependentArtifact!,
        generation: 2,
      },
      {
        id: ids.inputReaderExecution!,
        runId,
        stageKey: 'inputReader',
        state: 'passed',
        outputArtifactId: ids.inputReaderArtifact!,
        generation: 2,
      },
      {
        id: ids.unrelatedExecution!,
        runId,
        stageKey: 'unrelated',
        state: 'passed',
        outputArtifactId: ids.unrelatedArtifact!,
        generation: 2,
      },
    ]);

    await testDb.db.insert(stageAttempt).values([
      {
        id: ids.sourceAttempt!,
        stageExecutionId: ids.sourceExecution!,
        attemptNo: 1,
        outcome: 'success',
        resolvedInputs: {},
        artifactId: ids.sourceArtifact!,
      },
      {
        id: ids.dependentAttempt!,
        stageExecutionId: ids.dependentExecution!,
        attemptNo: 1,
        outcome: 'success',
        resolvedInputs: {
          'context.palette': {
            ref: { from: 'memory', key: 'palette' },
            memoryKey: 'palette',
            memoryVersion: 1,
          },
        },
        artifactId: ids.dependentArtifact!,
      },
      {
        id: ids.inputReaderAttempt!,
        stageExecutionId: ids.inputReaderExecution!,
        attemptNo: 1,
        outcome: 'success',
        resolvedInputs: {
          'slots.prompt': {
            ref: { from: 'input', inputKey: 'prompt' },
            inputKey: 'prompt',
          },
        },
        artifactId: ids.inputReaderArtifact!,
      },
      {
        id: ids.unrelatedAttempt!,
        stageExecutionId: ids.unrelatedExecution!,
        attemptNo: 1,
        outcome: 'success',
        resolvedInputs: {},
        artifactId: ids.unrelatedArtifact!,
      },
    ]);

    await testDb.db.insert(runMemory).values({
      id: ulid(),
      runId,
      memKey: 'palette',
      version: 1,
      writtenBy: 'source',
      kind: 'data',
      data: { color: 'coral' },
    });

    await testDb.db.insert(ledgerEntry).values([
      ...[
        [ids.sourceAttempt!, 'source', '2.0000'],
        [ids.dependentAttempt!, 'dependent', '1.1000'],
        [ids.inputReaderAttempt!, 'inputReader', '0.4000'],
        [ids.unrelatedAttempt!, 'unrelated', '0.9000'],
      ].map(([stageAttemptId, stageKey, amountUsd]) => ({
        id: ulid(),
        runId,
        stageKey: stageKey!,
        stageAttemptId: stageAttemptId!,
        kind: 'reservation' as const,
        category: 'stage_output' as const,
        amountUsd: amountUsd!,
      })),
    ]);
  });

  afterAll(async () => {
    await testDb.teardown();
  });

  it('loads observed reads and returns stable stage/input previews with conservative costs', async () => {
    const stagePreview = await service.preview({ runId, seed: { stageKeys: ['source'] } });
    expect(stagePreview.closure).toEqual({
      affectedStageKeys: ['source', 'dependent'],
      affectedExecutionIds: [ids.sourceExecution, ids.dependentExecution],
      affectedArtifactIds: [ids.sourceArtifact, ids.dependentArtifact],
      affectedItems: [
        {
          stageKey: 'source',
          stageExecutionId: ids.sourceExecution,
          artifactId: ids.sourceArtifact,
        },
        {
          stageKey: 'dependent',
          stageExecutionId: ids.dependentExecution,
          artifactId: ids.dependentArtifact,
        },
      ],
    });
    expect(stagePreview.costs).toEqual([
      {
        artifactId: ids.sourceArtifact,
        stageKey: 'source',
        spentUsd: 1.25,
        estimatedRerunUsd: 2,
      },
      {
        artifactId: ids.dependentArtifact,
        stageKey: 'dependent',
        spentUsd: 0.5,
        estimatedRerunUsd: 1.1,
      },
    ]);
    expect(stagePreview.totals).toEqual({ spentUsd: 1.75, estimatedRerunUsd: 3.1 });
    expect(stagePreview.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect((await service.preview({ runId, seed: { stageKeys: ['source'] } })).fingerprint).toBe(
      stagePreview.fingerprint,
    );

    const inputPreview = await service.preview({ runId, seed: { inputKeys: ['prompt'] } });
    expect(inputPreview.closure).toEqual({
      affectedStageKeys: ['inputReader'],
      affectedExecutionIds: [ids.inputReaderExecution],
      affectedArtifactIds: [ids.inputReaderArtifact, ids.inputArtifact],
      affectedItems: [
        {
          stageKey: 'inputReader',
          stageExecutionId: ids.inputReaderExecution,
          artifactId: ids.inputReaderArtifact,
        },
      ],
    });
    expect(inputPreview.totals).toEqual({ spentUsd: 0.2, estimatedRerunUsd: 0.4 });
  });

  it('applies staleness, tombstones, media retention, generation, and cursor atomically', async () => {
    const preview = await service.preview({ runId, seed: { stageKeys: ['source'] } });

    await expect(
      testDb.db.transaction(async (tx) => {
        await service.apply(tx, {
          runId,
          closure: preview.closure,
          targetStageKey: 'source',
        });
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    expect(
      await testDb.db
        .select()
        .from(artifact)
        .where(and(eq(artifact.id, ids.sourceArtifact!), eq(artifact.stale, false))),
    ).toHaveLength(1);
    expect((await service.listMemory(runId)).current.palette).toMatchObject({
      memKey: 'palette',
      version: 1,
    });

    await testDb.db.transaction((tx) =>
      service.apply(tx, {
        runId,
        closure: preview.closure,
        targetStageKey: 'source',
      }),
    );

    const artifacts = await testDb.db.select().from(artifact).where(eq(artifact.runId, runId));
    expect(artifacts.find((row) => row.id === ids.sourceArtifact)?.stale).toBe(true);
    expect(artifacts.find((row) => row.id === ids.dependentArtifact)?.stale).toBe(true);
    expect(artifacts.find((row) => row.id === ids.inputReaderArtifact)?.stale).toBe(false);
    expect(artifacts.find((row) => row.id === ids.unrelatedArtifact)?.stale).toBe(false);
    expect(artifacts.find((row) => row.id === ids.inputArtifact)?.stale).toBe(false);

    const executions = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.runId, runId));
    expect(executions.find((row) => row.stageKey === 'source')).toMatchObject({
      state: 'stale',
      outputArtifactId: null,
      generation: 3,
    });
    expect(executions.find((row) => row.stageKey === 'dependent')).toMatchObject({
      state: 'stale',
      outputArtifactId: null,
      generation: 2,
    });
    expect(executions.find((row) => row.stageKey === 'unrelated')).toMatchObject({
      state: 'passed',
      outputArtifactId: ids.unrelatedArtifact,
      generation: 2,
    });

    const memory = await service.listMemory(runId);
    expect(memory.current).toEqual({});
    expect(memory.history).toEqual([
      expect.objectContaining({ memKey: 'palette', version: 2, tombstone: true }),
      expect.objectContaining({ memKey: 'palette', version: 1, tombstone: false }),
    ]);

    const blobs = await testDb.db.select().from(blob).where(eq(blob.runId, runId));
    expect(blobs.find((row) => row.id === ids.dependentBlob)).toMatchObject({ gcEligible: true });
    expect(blobs.find((row) => row.id === ids.dependentBlob)?.gcEligibleAt).not.toBeNull();
    expect(blobs.find((row) => row.id === ids.unrelatedBlob)).toMatchObject({
      gcEligible: false,
      gcEligibleAt: null,
    });
    expect(blobs.find((row) => row.id === ids.inputBlob)).toMatchObject({
      gcEligible: false,
      gcEligibleAt: null,
    });

    const [runRow] = await testDb.db.select().from(run).where(eq(run.id, runId));
    expect(runRow?.cursorStageKey).toBe('source');
  });
});
