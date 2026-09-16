import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StageDef } from '@reefcraft/shared';
import { BindingResolverService } from '../../src/artifact/binding-resolver.service';
import { ArtifactService } from '../../src/artifact/artifact.service';
import { MemoryService } from '../../src/artifact/memory.service';
import { ulid } from '../../src/common/ulid';
import {
  artifact,
  blueprint,
  blueprintVersion,
  channel,
  run,
  runMemory,
} from '../../src/db/schema/index';
import { createTestDb, type TestDb } from '../support/test-db';

function textStage(key: string, overrides: Partial<StageDef> = {}): StageDef {
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
    ...overrides,
  };
}

/**
 * DB-backed coverage for BindingResolverService (const/input/prev/memory)
 * and the memory-write callback ArtifactService.finalize() runs inside its
 * own transaction. Seeds rows directly via Drizzle rather than through the
 * blueprint/run services — this suite is about the resolver/writer, not the
 * services that create those rows.
 */
describe('binding resolver + memory writes (e2e)', () => {
  let testDb: TestDb;
  let bindings: BindingResolverService;
  let artifacts: ArtifactService;
  let memory: MemoryService;
  let runId: string;

  beforeAll(async () => {
    testDb = await createTestDb();
    const db = testDb.db;
    bindings = new BindingResolverService(db);
    artifacts = new ArtifactService(db);
    memory = new MemoryService();

    const channelId = ulid();
    await db.insert(channel).values({ id: channelId, ownerId: 'local', name: 'Test Channel' });

    const blueprintId = ulid();
    await db.insert(blueprint).values({ id: blueprintId, channelId, name: 'Test Blueprint' });

    const versionId = ulid();
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

    runId = ulid();
    await db.insert(run).values({
      id: runId,
      channelId,
      blueprintVersionId: versionId,
      state: 'RUNNING',
      inputs: { topic: 'coral reefs', tags: ['a', 'b', 'c'] },
      resolvedConfig: {},
      budgetCapUsd: '10.0000',
    });

    await db.insert(artifact).values({
      id: ulid(),
      runId,
      producerStageKey: 'outline',
      kind: 'text',
      data: { text: 'a story about coral' },
      stale: false,
      reproLevel: 'exact',
      costUsd: '0.0000',
    });

    await db.insert(runMemory).values({
      id: ulid(),
      runId,
      memKey: 'outline',
      version: 1,
      writtenBy: 'outline',
      kind: 'data',
      data: { title: 'Coral Reefs 101', beats: ['intro', 'middle', 'end'] },
    });
  });

  afterAll(async () => {
    await testDb.teardown();
  });

  it('resolves {from: "const"}', async () => {
    const { value, provenance } = await bindings.resolve(
      { from: 'const', value: 42 },
      {
        runId,
        inputs: {},
      },
    );
    expect(value).toBe(42);
    expect(provenance.ref.from).toBe('const');
  });

  it('resolves {from: "input"} with a path and an index', async () => {
    const inputs = { topic: 'coral reefs', tags: ['a', 'b', 'c'] };
    const plain = await bindings.resolve({ from: 'input', inputKey: 'topic' }, { runId, inputs });
    expect(plain.value).toBe('coral reefs');

    const indexed = await bindings.resolve(
      { from: 'input', inputKey: 'tags', index: 1 },
      { runId, inputs },
    );
    expect(indexed.value).toBe('b');
  });

  it('resolves {from: "prev"} and unwraps a text artifact down to a plain string', async () => {
    const { value, provenance } = await bindings.resolve(
      { from: 'prev' },
      { runId, prevStageKey: 'outline', inputs: {} },
    );
    expect(value).toBe('a story about coral');
    expect(provenance.artifactId).toBeDefined();
  });

  it('throws a clear error when {from: "prev"} has no preceding stage', async () => {
    await expect(bindings.resolve({ from: 'prev' }, { runId, inputs: {} })).rejects.toThrow(
      'on the first stage is invalid',
    );
  });

  it('resolves {from: "memory"} to the current (highest) version', async () => {
    const { value, provenance } = await bindings.resolve(
      { from: 'memory', key: 'outline', path: 'title' },
      { runId, inputs: {} },
    );
    expect(value).toBe('Coral Reefs 101');
    expect(provenance.memoryVersion).toBe(1);
  });

  it('throws naming phase 4/7/8 for asset/item/prevItem/role refs', async () => {
    await expect(
      bindings.resolve({ from: 'asset', assetId: 'x' }, { runId, inputs: {} }),
    ).rejects.toThrow('phase 4');
    await expect(bindings.resolve({ from: 'item' }, { runId, inputs: {} })).rejects.toThrow(
      'phase 7',
    );
    await expect(bindings.resolve({ from: 'prevItem' }, { runId, inputs: {} })).rejects.toThrow(
      'phase 7',
    );
    await expect(
      bindings.resolve({ from: 'role', roleKey: 'host' }, { runId, inputs: {} }),
    ).rejects.toThrow('phase 8');
  });

  it('resolveAll resolves every slot and context ref on a stage', async () => {
    const stage = textStage('script', {
      slots: {},
      context: {
        outline: { from: 'prev' },
        topic: { from: 'input', inputKey: 'topic' },
      },
    });
    const resolved = await bindings.resolveAll(stage, {
      runId,
      prevStageKey: 'outline',
      inputs: { topic: 'coral reefs' },
    });
    expect(resolved.context.outline).toBe('a story about coral');
    expect(resolved.context.topic).toBe('coral reefs');
    expect(resolved.provenance['context.outline']?.artifactId).toBeDefined();
  });

  it('resolveRefEnvelopes returns {kind, data, probe} for a script check ref', async () => {
    const { refs } = await bindings.resolveRefEnvelopes(
      { outline: { from: 'memory', key: 'outline' } },
      { runId, inputs: {} },
    );
    expect(refs.outline?.kind).toBe('data');
    expect(refs.outline?.data).toEqual({
      title: 'Coral Reefs 101',
      beats: ['intro', 'middle', 'end'],
    });
  });

  it("memory writes land inside ArtifactService.finalize()'s transaction and are append-only versioned", async () => {
    const stage = textStage('recap', { writes: { recap: '$' } });
    const stageExecutionId = ulid();

    const firstArtifactId = await artifacts.recordAttemptArtifact({
      runId,
      producerStageKey: stage.key,
      kind: 'text',
      data: { text: 'first pass' },
      reproLevel: 'exact',
      costUsd: 0,
    });
    await artifacts.finalize({
      runId,
      stageExecutionId,
      producerStageKey: stage.key,
      newArtifactId: firstArtifactId,
      applyWrites: memory.buildWriteCallback(stage, {
        runId,
        stageKey: stage.key,
        kind: 'text',
        data: { text: 'first pass' },
      }),
    });

    const firstRead = await bindings.resolve(
      { from: 'memory', key: 'recap' },
      { runId, inputs: {} },
    );
    expect(firstRead.value).toEqual({ text: 'first pass' });
    expect(firstRead.provenance.memoryVersion).toBe(1);

    const secondArtifactId = await artifacts.recordAttemptArtifact({
      runId,
      producerStageKey: stage.key,
      kind: 'text',
      data: { text: 'second pass' },
      reproLevel: 'exact',
      costUsd: 0,
    });
    await artifacts.finalize({
      runId,
      stageExecutionId,
      producerStageKey: stage.key,
      newArtifactId: secondArtifactId,
      applyWrites: memory.buildWriteCallback(stage, {
        runId,
        stageKey: stage.key,
        kind: 'text',
        data: { text: 'second pass' },
      }),
    });

    const secondRead = await bindings.resolve(
      { from: 'memory', key: 'recap' },
      { runId, inputs: {} },
    );
    expect(secondRead.value).toEqual({ text: 'second pass' });
    expect(secondRead.provenance.memoryVersion).toBe(2);
  });
});
