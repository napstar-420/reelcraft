import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { unzipSync } from 'fflate';
import { PackageManifest, PackagePipeline, type StageDef } from '@reelcraft/shared';
import { ulid } from '../../src/common/ulid';
import {
  asset,
  blob,
  blueprint,
  blueprintVersion,
  channel,
  character,
} from '../../src/db/schema/index';
import { PackageExportService } from '../../src/package/package-export.service';
import { sha256Hex, verifyBytes } from '../../src/package/package-signing';
import { STORAGE_ADAPTER, type StorageAdapter } from '../../src/storage/storage.adapter';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

const PNG = Buffer.from('89504e470d0a1a0a-asset-bytes', 'utf8');
const REF_A = Buffer.from('reference-a', 'utf8');
const REF_B = Buffer.from('reference-b', 'utf8');

describe('package export (e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;
  let exporter: PackageExportService;
  let storage: StorageAdapter;
  let ids: {
    channelId: string;
    assetId: string;
    characterId: string;
    blueprintId: string;
    versionId: string;
    refA: string;
    refB: string;
  };

  async function seedBlob(
    key: string,
    body: Buffer,
    scope: 'asset' | 'character',
    characterId?: string,
  ) {
    await storage.put(key, body, { mime: 'image/png' });
    const id = ulid();
    await testDb.db.insert(blob).values({
      id,
      scope,
      characterId: characterId ?? null,
      bucket: 'test',
      objectKey: key,
      mime: 'image/png',
      bytes: body.byteLength,
      sha256: sha256Hex(body),
    });
    return id;
  }

  function stage(over: Partial<StageDef>): StageDef {
    return {
      key: 'img',
      label: 'Image',
      capability: 'text.generate',
      config: {},
      slots: {},
      context: {},
      output: { kind: 'text' },
      checks: [],
      ...over,
    };
  }

  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb);
    exporter = testApp.app.get(PackageExportService);
    storage = testApp.app.get(STORAGE_ADAPTER);
    const db = testDb.db;

    const channelId = ulid();
    await db.insert(channel).values({ id: channelId, ownerId: 'local', name: 'C' });

    const assetBlob = await seedBlob('local/c/assets/logo.png', PNG, 'asset');
    const assetId = ulid();
    await db.insert(asset).values({
      id: assetId,
      channelId,
      name: 'Logo',
      kind: 'media.image',
      blobId: assetBlob,
    });

    const characterId = ulid();
    await db.insert(character).values({
      id: characterId,
      channelId,
      scope: 'channel',
      name: 'Host',
      description: 'A friendly host',
      readiness: 'ready',
    });
    const refA = await seedBlob('local/chars/a.png', REF_A, 'character', characterId);
    const refB = await seedBlob('local/chars/b.png', REF_B, 'character', characterId);
    await db
      .update(character)
      .set({
        referenceSet: [
          { blobId: refA, view: 'front', origin: 'uploaded', order: 0 },
          { blobId: refB, view: 'profile', origin: 'uploaded', order: 1 },
        ],
      })
      .where(eq(character.id, characterId));

    const blueprintId = ulid();
    await db.insert(blueprint).values({ id: blueprintId, channelId, name: 'My Shorts!' });
    const versionId = ulid();
    await db.insert(blueprintVersion).values({
      id: versionId,
      blueprintId,
      major: 1,
      minor: 2,
      graph: [
        stage({
          slots: {
            logo: { from: 'coalesce', refs: [{ from: 'asset', assetId }, { from: 'prev' }] },
          },
          context: { who: { from: 'role', roleKey: 'host' } },
          config: { accounts: ['me@example.com'] },
          model: { provider: 'fake', modelId: 'fake-text-1' },
        }),
      ],
      inputs: [],
      roles: [
        { key: 'host', label: 'Host', required: true, characterId, referenceBlobIds: [refA] },
      ],
      defaults: {},
      budget: { runCapUsd: 5 },
      validation: [],
      runnable: true,
    });
    ids = { channelId, assetId, characterId, blueprintId, versionId, refA, refB };
  });

  afterAll(async () => {
    try {
      await testApp?.close();
    } finally {
      await testDb.teardown();
    }
  });

  it('previews the references and flags what looks personal', async () => {
    const preview = await exporter.preview(ids.versionId);
    expect(preview).toMatchObject({ name: 'My Shorts!', version: '1.2' });
    expect(preview.references).toEqual([
      expect.objectContaining({ id: ids.assetId, kind: 'asset', missing: false, tooLarge: false }),
      expect.objectContaining({ id: ids.characterId, kind: 'character', missing: false }),
    ]);
    expect(preview.privacy).toEqual([{ path: 'graph[0].config.accounts[0]', kind: 'email' }]);
  });

  it('builds a signed package with no local ids and the media it bundles', async () => {
    const { filename, bytes } = await exporter.build(ids.versionId, { choices: {} });
    expect(filename).toBe('my-shorts-1.2.reelpack');
    const zip = unzipSync(bytes);

    const manifestBytes = zip['manifest.json']!;
    const manifest = PackageManifest.parse(JSON.parse(Buffer.from(manifestBytes).toString()));
    expect(
      verifyBytes(
        manifestBytes,
        Buffer.from(zip['manifest.sig']!).toString(),
        manifest.author.publicKey,
      ),
    ).toBe(true);
    expect(manifest.package.version).toBe('1.2');
    expect(manifest.requires).toEqual({ capabilities: ['text.generate'], providers: ['fake'] });

    // every entry but the manifest and signature is listed, and its hash matches
    const listed = new Set(manifest.files.map((f) => f.path));
    expect(new Set(Object.keys(zip).filter((p) => !p.startsWith('manifest.')))).toEqual(listed);
    for (const f of manifest.files) expect(sha256Hex(zip[f.path]!)).toBe(f.sha256);

    const raw = Buffer.from(zip['pipeline.json']!).toString();
    for (const local of [ids.assetId, ids.characterId, ids.refA, ids.refB]) {
      expect(raw).not.toContain(local);
    }
    const pipeline = PackagePipeline.parse(JSON.parse(raw));
    expect(pipeline.graph[0]!.slots.logo).toEqual({
      from: 'coalesce',
      refs: [{ from: 'asset', assetId: '@slot:asset-1' }, { from: 'prev' }],
    });
    expect(pipeline.roles[0]).toEqual({
      key: 'host',
      label: 'Host',
      required: true,
      characterId: '@slot:character-host',
    });

    const character = manifest.slots.find((s) => s.kind === 'character')!;
    expect(character.kind === 'character' && character.bundled).toMatchObject({
      name: 'Host',
      description: 'A friendly host',
    });
    // only the reference the role selected is bundled
    expect(character.kind === 'character' && character.bundled?.references).toHaveLength(1);
    expect(character.kind === 'character' && character.bundled?.selected).toHaveLength(1);
  });

  it('leaves a slot instead of media when asked, or when a reference is gone', async () => {
    const slotOnly = await exporter.build(ids.versionId, {
      choices: { [ids.assetId]: 'slot', [ids.characterId]: 'slot' },
    });
    const zip = unzipSync(slotOnly.bytes);
    expect(Object.keys(zip).filter((p) => p.startsWith('media/'))).toEqual([]);
    const manifest = PackageManifest.parse(
      JSON.parse(Buffer.from(zip['manifest.json']!).toString()),
    );
    expect(manifest.slots.every((s) => s.bundled === null)).toBe(true);

    await testDb.db
      .update(asset)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(asset.id, ids.assetId));
    const preview = await exporter.preview(ids.versionId);
    expect(preview.references[0]).toMatchObject({ missing: true });
    const { bytes } = await exporter.build(ids.versionId, { choices: {} });
    const m = PackageManifest.parse(
      JSON.parse(Buffer.from(unzipSync(bytes)['manifest.json']!).toString()),
    );
    expect(m.slots.find((s) => s.kind === 'asset')?.bundled).toBeNull();
  });

  it('keeps one package id per blueprint across exports', async () => {
    const first = await exporter.build(ids.versionId, { choices: {} });
    const second = await exporter.build(ids.versionId, { choices: {} });
    const idOf = (b: Uint8Array) =>
      PackageManifest.parse(JSON.parse(Buffer.from(unzipSync(b)['manifest.json']!).toString()))
        .package.id;
    expect(idOf(first.bytes)).toBe(idOf(second.bytes));
    const [bp] = await testDb.db.select().from(blueprint).where(eq(blueprint.id, ids.blueprintId));
    expect(bp?.packageId).toBe(idOf(first.bytes));
  });

  it('refuses drafts and versions that are not runnable', async () => {
    const draftId = ulid();
    const unrunnableId = ulid();
    const base = {
      blueprintId: ids.blueprintId,
      graph: [],
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 1 },
      validation: [],
    };
    await testDb.db.insert(blueprintVersion).values([
      { ...base, id: draftId, major: 9, minor: 0, runnable: true, draft: true },
      { ...base, id: unrunnableId, major: 9, minor: 1, runnable: false },
    ]);
    await expect(exporter.preview(draftId)).rejects.toThrow(/Save the blueprint/);
    await expect(exporter.build(unrunnableId, { choices: {} })).rejects.toThrow(
      /Fix the blueprint/,
    );
  });
});
