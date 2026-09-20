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
    memory = new MemoryService();
    bindings = new BindingResolverService(db, memory);
    artifacts = new ArtifactService(db);

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

    // A superseded (stale) artifact alongside the active one for the same
    // producer stage — proves {from: 'prev'} picks the active row, not just
    // "a" row.
    await db.insert(artifact).values([
      {
        id: ulid(),
        runId,
        producerStageKey: 'staleCheck',
        kind: 'text',
        data: { text: 'OLD attempt' },
        stale: true,
        reproLevel: 'exact',
        costUsd: '0.0000',
      },
      {
        id: ulid(),
        runId,
        producerStageKey: 'staleCheck',
        kind: 'text',
        data: { text: 'NEW attempt' },
        stale: false,
        reproLevel: 'exact',
        costUsd: '0.0000',
      },
    ]);

    // Media resolves to a compact descriptor, never raw provider data.
    await db.insert(artifact).values({
      id: ulid(),
      runId,
      producerStageKey: 'mediaStage',
      kind: 'media.image',
      data: { url: 'blob://fake' },
      stale: false,
      reproLevel: 'exact',
      costUsd: '0.0000',
    });

    // A tombstoned higher version alongside an older non-tombstoned one — the
    // tombstone must hide the key completely, never resurrect version 1.
    await db.insert(runMemory).values([
      {
        id: ulid(),
        runId,
        memKey: 'tomb',
        version: 1,
        writtenBy: 'outline',
        kind: 'data',
        data: { v: 1 },
        tombstone: false,
      },
      {
        id: ulid(),
        runId,
        memKey: 'tomb',
        version: 2,
        writtenBy: 'outline',
        kind: 'data',
        data: { v: 2 },
        tombstone: true,
      },
    ]);
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

  it('resolves {from: "input"} plain, with an index, and with a path', async () => {
    const inputs = { topic: 'coral reefs', tags: ['a', 'b', 'c'], nested: { field: 'deep' } };
    const plain = await bindings.resolve({ from: 'input', inputKey: 'topic' }, { runId, inputs });
    expect(plain.value).toBe('coral reefs');

    const indexed = await bindings.resolve(
      { from: 'input', inputKey: 'tags', index: 1 },
      { runId, inputs },
    );
    expect(indexed.value).toBe('b');

    const pathed = await bindings.resolve(
      { from: 'input', inputKey: 'nested', path: 'field' },
      { runId, inputs },
    );
    expect(pathed.value).toBe('deep');
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

  it('{from: "prev"} picks the active artifact, not a stale/superseded one', async () => {
    const { value } = await bindings.resolve(
      { from: 'prev' },
      { runId, prevStageKey: 'staleCheck', inputs: {} },
    );
    expect(value).toBe('NEW attempt');
  });

  it('{from: "prev"} on a media-kind artifact returns a compact descriptor, never raw media data', async () => {
    const { value } = await bindings.resolve(
      { from: 'prev' },
      { runId, prevStageKey: 'mediaStage', inputs: {} },
    );
    expect(value).toMatchObject({ kind: 'media.image', artifactId: expect.any(String) });
  });

  it('resolves {from: "memory"} to the current (highest) version', async () => {
    const { value, provenance } = await bindings.resolve(
      { from: 'memory', key: 'outline', path: 'title' },
      { runId, inputs: {} },
    );
    expect(value).toBe('Coral Reefs 101');
    expect(provenance.memoryVersion).toBe(1);
  });

  it('{from: "memory"} treats a latest tombstone as absent and never resurrects an older value', async () => {
    await expect(
      bindings.resolve({ from: 'memory', key: 'tomb' }, { runId, inputs: {} }),
    ).rejects.toThrow('no memory entry');
  });

  it('{from: "memory"} fails closed when its media artifact is stale or unavailable', async () => {
    const [mediaArtifact] = await testDb.db.select().from(artifact).limit(1);
    await testDb.db.insert(runMemory).values({
      id: ulid(),
      runId,
      memKey: 'mediaMem',
      version: 1,
      writtenBy: 'outline',
      kind: 'media.image',
      artifactId: mediaArtifact?.id,
    });

    await expect(
      bindings.resolve({ from: 'memory', key: 'mediaMem' }, { runId, inputs: {} }),
    ).rejects.toThrow('stale or unavailable');
  });

  it('throws naming phase 7/8 for item/prevItem/role refs', async () => {
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

  it('{from: "asset"} throws an engine-bug error when run.assetBindings has no entry', async () => {
    await expect(
      bindings.resolve({ from: 'asset', assetId: 'x' }, { runId, inputs: {} }),
    ).rejects.toThrow('no asset binding');
  });

  it('{from: "asset"} resolves from the snapshotted run.assetBindings, never the live asset table', async () => {
    const resolved = await bindings.resolve(
      { from: 'asset', assetId: 'logo' },
      { runId, inputs: {}, assetBindings: { logo: { blobId: 'blob-1', kind: 'media.image' } } },
    );
    expect(resolved.value).toEqual({ blobId: 'blob-1', kind: 'media.image' });
    expect(resolved.provenance).toEqual({
      ref: { from: 'asset', assetId: 'logo' },
      assetId: 'logo',
    });
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

  it('resolveRefEnvelopes tags a const/input ref "literal", distinct from the real "data" ArtifactKind', async () => {
    const { refs } = await bindings.resolveRefEnvelopes(
      { n: { from: 'const', value: 7 } },
      { runId, inputs: {} },
    );
    expect(refs.n).toEqual({ kind: 'literal', data: 7 });
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

  it('lists only latest visible memory while retaining the complete append-only history', async () => {
    const current = await memory.listCurrent(testDb.db, runId);
    expect(current.some((row) => row.memKey === 'outline' && row.version === 1)).toBe(true);
    expect(current.some((row) => row.memKey === 'tomb')).toBe(false);

    const history = await memory.listHistory(testDb.db, runId);
    expect(history.filter((row) => row.memKey === 'tomb')).toEqual([
      expect.objectContaining({ version: 2, tombstone: true }),
      expect.objectContaining({ version: 1, tombstone: false, data: { v: 1 } }),
    ]);
  });

  it('appends tombstones transactionally only for current values written by invalidated writers', async () => {
    await testDb.db.transaction(async (tx) => {
      await memory.appendTombstones(tx, runId, [{ stageKey: 'outline' }]);
    });

    const current = await memory.listCurrent(testDb.db, runId);
    expect(current.some((row) => row.memKey === 'outline')).toBe(false);

    const history = await memory.listHistory(testDb.db, runId);
    expect(history.filter((row) => row.memKey === 'outline')).toEqual([
      expect.objectContaining({ version: 2, tombstone: true, writtenBy: 'outline' }),
      expect.objectContaining({ version: 1, tombstone: false }),
    ]);

    // Reapplying the same invalidation is idempotent: a top tombstone is not
    // itself a current value eligible for another tombstone.
    await testDb.db.transaction(async (tx) => {
      await memory.appendTombstones(tx, runId, [{ stageKey: 'outline' }]);
    });
    const repeatedHistory = await memory.listHistory(testDb.db, runId);
    expect(repeatedHistory.filter((row) => row.memKey === 'outline')).toHaveLength(2);
  });

  it('an iterating stage write lands at key#i, and a bare-key read aggregates the group in order', async () => {
    const stage = textStage('shots', { writes: { shots: '$' } });
    for (const i of [0, 1, 2]) {
      const artifactId = await artifacts.recordAttemptArtifact({
        runId,
        producerStageKey: stage.key,
        itemIndex: i,
        kind: 'text',
        data: { text: `shot ${i}` },
        reproLevel: 'exact',
        costUsd: 0,
      });
      await artifacts.finalize({
        runId,
        stageExecutionId: ulid(),
        producerStageKey: stage.key,
        itemIndex: i,
        newArtifactId: artifactId,
        applyWrites: memory.buildWriteCallback(stage, {
          runId,
          stageKey: stage.key,
          itemIndex: i,
          kind: 'text',
          data: { text: `shot ${i}` },
        }),
      });
    }

    // An explicit indexed read keeps today's single-value shape unchanged.
    const explicit = await bindings.resolve(
      { from: 'memory', key: 'shots#1' },
      { runId, inputs: {} },
    );
    expect(explicit.value).toEqual({ text: 'shot 1' });
    expect(explicit.provenance.memoryVersion).toBe(1);
    expect(explicit.provenance.memoryVersions).toBeUndefined();

    // A bare-key read aggregates the group into an ordered array.
    const group = await bindings.resolve({ from: 'memory', key: 'shots' }, { runId, inputs: {} });
    expect(group.value).toEqual([{ text: 'shot 0' }, { text: 'shot 1' }, { text: 'shot 2' }]);
    expect(group.provenance.memoryVersion).toBeUndefined();
    expect(group.provenance.memoryVersions).toEqual([
      { itemIndex: 0, version: 1 },
      { itemIndex: 1, version: 1 },
      { itemIndex: 2, version: 1 },
    ]);

    const envelopes = await bindings.resolveRefEnvelopes(
      { x: { from: 'memory', key: 'shots' } },
      { runId, inputs: {} },
    );
    expect(envelopes.refs.x).toEqual({
      kind: 'literal',
      data: [{ text: 'shot 0' }, { text: 'shot 1' }, { text: 'shot 2' }],
    });
    expect(envelopes.provenance.x?.memoryVersions).toHaveLength(3);
  });

  it('a group read after a partial re-run reflects the tombstoned set, not the original count (§6.3 orphan scenario)', async () => {
    await testDb.db.transaction(async (tx) => {
      await memory.appendTombstones(tx, runId, [{ stageKey: 'shots', itemIndex: 2 }]);
    });

    await expect(
      bindings.resolve({ from: 'memory', key: 'shots#2' }, { runId, inputs: {} }),
    ).rejects.toThrow('no memory entry');

    // The group read now reflects only the surviving two indices — an
    // orphaned entry from the old count never resurfaces.
    const group = await bindings.resolve({ from: 'memory', key: 'shots' }, { runId, inputs: {} });
    expect(group.value).toEqual([{ text: 'shot 0' }, { text: 'shot 1' }]);

    // Re-running item 2 appends a new version at the same index rather than
    // resurrecting the tombstoned one.
    const stage = textStage('shots', { writes: { shots: '$' } });
    const artifactId = await artifacts.recordAttemptArtifact({
      runId,
      producerStageKey: stage.key,
      itemIndex: 2,
      kind: 'text',
      data: { text: 'shot 2 retried' },
      reproLevel: 'exact',
      costUsd: 0,
    });
    await artifacts.finalize({
      runId,
      stageExecutionId: ulid(),
      producerStageKey: stage.key,
      itemIndex: 2,
      newArtifactId: artifactId,
      applyWrites: memory.buildWriteCallback(stage, {
        runId,
        stageKey: stage.key,
        itemIndex: 2,
        kind: 'text',
        data: { text: 'shot 2 retried' },
      }),
    });
    const rebuilt = await bindings.resolve({ from: 'memory', key: 'shots' }, { runId, inputs: {} });
    expect(rebuilt.value).toEqual([
      { text: 'shot 0' },
      { text: 'shot 1' },
      { text: 'shot 2 retried' },
    ]);
  });

  it('a group read where every indexed entry is tombstoned throws, not an empty array', async () => {
    const stage = textStage('allGone', { writes: { allGone: '$' } });
    for (const i of [0, 1]) {
      const artifactId = await artifacts.recordAttemptArtifact({
        runId,
        producerStageKey: stage.key,
        itemIndex: i,
        kind: 'text',
        data: { text: `x${i}` },
        reproLevel: 'exact',
        costUsd: 0,
      });
      await artifacts.finalize({
        runId,
        stageExecutionId: ulid(),
        producerStageKey: stage.key,
        itemIndex: i,
        newArtifactId: artifactId,
        applyWrites: memory.buildWriteCallback(stage, {
          runId,
          stageKey: stage.key,
          itemIndex: i,
          kind: 'text',
          data: { text: `x${i}` },
        }),
      });
    }
    await testDb.db.transaction(async (tx) => {
      await memory.appendTombstones(tx, runId, [
        { stageKey: 'allGone', itemIndex: 0 },
        { stageKey: 'allGone', itemIndex: 1 },
      ]);
    });
    await expect(
      bindings.resolve({ from: 'memory', key: 'allGone' }, { runId, inputs: {} }),
    ).rejects.toThrow('no memory entry');
  });

  it('throws rather than silently writing undefined when a writes path does not resolve', async () => {
    const stage = textStage('badWrite', { writes: { badKey: 'no.such.path' } });
    const stageExecutionId = ulid();
    const artifactId = await artifacts.recordAttemptArtifact({
      runId,
      producerStageKey: stage.key,
      kind: 'text',
      data: { text: 'irrelevant' },
      reproLevel: 'exact',
      costUsd: 0,
    });

    await expect(
      artifacts.finalize({
        runId,
        stageExecutionId,
        producerStageKey: stage.key,
        newArtifactId: artifactId,
        applyWrites: memory.buildWriteCallback(stage, {
          runId,
          stageKey: stage.key,
          kind: 'text',
          data: { text: 'irrelevant' },
        }),
      }),
    ).rejects.toThrow('did not resolve');

    // And no memory row was written for it — the throw happened before the
    // insert, inside the same transaction as the (rolled-back) finalize.
    await expect(
      bindings.resolve({ from: 'memory', key: 'badKey' }, { runId, inputs: {} }),
    ).rejects.toThrow('no memory entry');
  });
});
