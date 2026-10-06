import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { zipSync, unzipSync } from 'fflate';
import type { InstallPackageDto, PackageManifest } from '@reelcraft/shared';
import { ulid } from '../../src/common/ulid';
import {
  asset,
  blueprint,
  blueprintVersion,
  character,
  packageImport,
  storageOrphan,
} from '../../src/db/schema/index';
import { IdentityService } from '../../src/package/identity.service';
import { PackageExportService } from '../../src/package/package-export.service';
import { PackageInspectService } from '../../src/package/package-inspect.service';
import { PackageInstallService } from '../../src/package/package-install.service';
import { objectKey } from '../../src/storage/object-key';
import { STORAGE_ADAPTER, type StorageAdapter } from '../../src/storage/storage.adapter';
import { buildTestApp, type TestApp } from '../support/build-app';
import {
  pngBytes,
  seedBlob,
  seedChannel,
  seedSource,
  type SourceIds,
} from '../support/package-fixture';
import { createTestDb, type TestDb } from '../support/test-db';

describe('package export → import (e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;
  let storage: StorageAdapter;
  let exporter: PackageExportService;
  let inspector: PackageInspectService;
  let installer: PackageInstallService;
  let identity: IdentityService;
  let src: SourceIds;
  let target: string; // the channel packages are imported into

  /** Puts bytes where a browser upload would, and returns the key. */
  async function upload(zip: Uint8Array): Promise<string> {
    const key = objectKey.packageUpload('local', ulid());
    await storage.put(key, Buffer.from(zip), { mime: 'application/octet-stream' });
    return key;
  }

  const exportZip = async (versionId = src.versionId, choices = {}) =>
    (await exporter.build(versionId, { choices })).bytes;

  const request = (key: string, over: Partial<InstallPackageDto> = {}): InstallPackageDto => ({
    objectKey: key,
    channelId: target,
    mode: 'new',
    name: 'Imported Shorts',
    runCapUsd: 3,
    bindings: {},
    trustAuthor: false,
    ...over,
  });

  const orphanReasons = async (key: string) =>
    (
      await testDb.db
        .select({ reason: storageOrphan.reason })
        .from(storageOrphan)
        .where(eq(storageOrphan.objectKey, key))
    ).map((r) => r.reason);

  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb);
    storage = testApp.app.get<StorageAdapter>(STORAGE_ADAPTER);
    exporter = testApp.app.get(PackageExportService);
    inspector = testApp.app.get(PackageInspectService);
    installer = testApp.app.get(PackageInstallService);
    identity = testApp.app.get(IdentityService);
    src = await seedSource(testDb, storage);
    target = await seedChannel(testDb, 'Target');
  });

  afterAll(async () => {
    try {
      await testApp?.close();
    } finally {
      await testDb.teardown();
    }
  });

  it('installs a package into another channel with its own character and asset', async () => {
    const key = await upload(await exportZip());
    const { report } = await inspector.inspect('local', key, target);
    expect(report.issues.filter((i) => i.severity === 'block')).toEqual([]);
    expect(report.signer).toMatchObject({ signed: true, own: true, trusted: true });
    expect(report.summary).toMatchObject({ name: 'My Shorts!', version: '1.2' });
    expect(report.requires).toEqual({ capabilities: ['text.generate'], providers: ['fake'] });
    expect(report.installed).toBeNull();

    const result = await installer.install('local', request(key));
    expect(result.runnable).toBe(true);

    const [bp] = await testDb.db
      .select()
      .from(blueprint)
      .where(eq(blueprint.id, result.blueprintId));
    expect(bp).toMatchObject({ channelId: target, name: 'Imported Shorts' });
    expect(bp?.currentVersionId).toBe(result.blueprintVersionId);

    const [newCharacter] = await testDb.db
      .select()
      .from(character)
      .where(eq(character.channelId, target));
    const [newAsset] = await testDb.db.select().from(asset).where(eq(asset.channelId, target));
    expect(newCharacter).toMatchObject({ name: 'Host', scope: 'channel', readiness: 'ready' });
    expect(newCharacter!.id).not.toBe(src.characterId);
    expect(newAsset).toMatchObject({ name: 'Logo', kind: 'media.image' });
    expect(newAsset!.id).not.toBe(src.assetId);

    // the media really is in storage under the new ids
    const refs = newCharacter!.referenceSet as Array<{ blobId: string }>;
    expect(refs).toHaveLength(1);

    const [version] = await testDb.db
      .select()
      .from(blueprintVersion)
      .where(eq(blueprintVersion.id, result.blueprintVersionId));
    expect(version).toMatchObject({ major: 1, minor: 0, runnable: true });
    expect(version!.budget).toEqual({ runCapUsd: 3 });
    const roles = version!.roles as Array<{ characterId: string; referenceBlobIds: string[] }>;
    expect(roles[0]!.characterId).toBe(newCharacter!.id);
    expect(roles[0]!.referenceBlobIds).toEqual([refs[0]!.blobId]);
    const graph = JSON.stringify(version!.graph);
    expect(graph).toContain(newAsset!.id);
    expect(graph).not.toContain(src.assetId);

    const [origin] = await testDb.db
      .select()
      .from(packageImport)
      .where(eq(packageImport.blueprintId, result.blueprintId));
    expect(origin).toMatchObject({
      packageVersion: '1.2',
      authorFingerprint: report.signer.fingerprint,
    });
    // an upload that was used is queued for cleanup
    expect(await orphanReasons(key)).toEqual(['package_upload']);
  });

  it('recognises the same package again and only offers it as a separate copy', async () => {
    const key = await upload(await exportZip());
    const { report } = await inspector.inspect('local', key, target);
    expect(report.installed).toMatchObject({
      blueprintName: 'Imported Shorts',
      version: '1.2',
      relation: 'same',
      canUpdate: false,
    });
    expect(report.suggestedName).toBe('My Shorts!');

    // a name in use is refused, and bundled names that clash are renamed
    await expect(installer.install('local', request(key))).rejects.toMatchObject({
      status: 409,
    });
    await installer.install('local', request(key, { name: 'Second copy' }));
    const names = (
      await testDb.db
        .select({ name: character.name })
        .from(character)
        .where(eq(character.channelId, target))
    ).map((r) => r.name);
    expect(names.sort()).toEqual(['Host', 'Host (imported)']);
  });

  it('adds a newer version of the same package as a new version of the blueprint', async () => {
    const newerId = ulid();
    const [old] = await testDb.db
      .select()
      .from(blueprintVersion)
      .where(eq(blueprintVersion.id, src.versionId));
    await testDb.db.insert(blueprintVersion).values({
      ...old!,
      id: newerId,
      minor: 3,
      graph: (old!.graph as Array<{ label: string }>).map((s) => ({ ...s, label: 'Image v1.3' })),
    });
    const key = await upload(await exportZip(newerId));
    const { report } = await inspector.inspect('local', key, target);
    expect(report.installed).toMatchObject({ relation: 'newer', canUpdate: true });

    const installed = report.installed!;
    const result = await installer.install(
      'local',
      request(key, { mode: 'update', targetBlueprintId: installed.blueprintId }),
    );
    expect(result.blueprintId).toBe(installed.blueprintId);
    const versions = await testDb.db
      .select()
      .from(blueprintVersion)
      .where(eq(blueprintVersion.blueprintId, installed.blueprintId));
    expect(versions.map((v) => `${v.major}.${v.minor}`).sort()).toEqual(['1.0', '1.1']);

    // an update to the wrong blueprint is refused
    const again = await upload(await exportZip(newerId));
    await expect(
      installer.install(
        'local',
        request(again, { mode: 'update', targetBlueprintId: src.blueprintId }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('blocks a package that was changed after it was signed', async () => {
    const files = unzipSync(await exportZip());
    const mediaPath = Object.keys(files).find((p) => p.startsWith('media/'))!;
    files[mediaPath] = new Uint8Array(pngBytes('swapped'));
    const key = await upload(zipSync(files));
    const { report, opened } = await inspector.inspect('local', key, target);
    expect(opened).toBeNull();
    expect(report.issues.map((i) => i.code)).toContain('hash_mismatch');
    await expect(
      installer.install('local', request(key, { name: 'Tampered' })),
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  it('blocks a stage this Reelcraft does not have', async () => {
    const files = unzipSync(await exportZip());
    const pipeline = JSON.parse(Buffer.from(files['pipeline.json']!).toString());
    pipeline.graph[0].capability = 'does.not_exist';
    files['pipeline.json'] = Buffer.from(JSON.stringify(pipeline));
    const manifest = JSON.parse(Buffer.from(files['manifest.json']!).toString()) as PackageManifest;
    const entry = manifest.files.find((f) => f.path === 'pipeline.json')!;
    const { sha256Hex } = await import('../../src/package/package-signing');
    entry.sha256 = sha256Hex(files['pipeline.json']!);
    entry.bytes = files['pipeline.json']!.byteLength;
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    files['manifest.json'] = manifestBytes;
    files['manifest.sig'] = Buffer.from((await identity.sign(manifestBytes)).signature);

    const { report } = await inspector.inspect('local', await upload(zipSync(files)), target);
    expect(report.issues).toContainEqual(
      expect.objectContaining({ severity: 'block', code: 'unknown_capability' }),
    );
  });

  it('needs a slot filled, then uses the importer’s own character and asset', async () => {
    const key = await upload(
      await exportZip(src.versionId, { [src.assetId]: 'slot', [src.characterId]: 'slot' }),
    );
    const { report } = await inspector.inspect('local', key, target);
    expect(report.slots.every((s) => s.bundled === null)).toBe(true);
    await expect(installer.install('local', request(key, { name: 'Slots' }))).rejects.toThrow(
      /Fill these slots/,
    );

    const mine = ulid();
    const myAssetBlob = await seedBlob(
      testDb,
      storage,
      `local/${target}/assets/mine.png`,
      pngBytes('m'),
      'asset',
    );
    const myAsset = ulid();
    await testDb.db.insert(asset).values({
      id: myAsset,
      channelId: target,
      name: 'My logo',
      kind: 'media.image',
      blobId: myAssetBlob,
    });
    await testDb.db.insert(character).values({
      id: mine,
      channelId: target,
      scope: 'channel',
      name: 'Mine',
      description: '',
      readiness: 'ready',
    });
    const myRef = await seedBlob(
      testDb,
      storage,
      `local/characters/${mine}/refs/r.png`,
      pngBytes('r'),
      'character',
      mine,
    );
    await testDb.db
      .update(character)
      .set({ referenceSet: [{ blobId: myRef, view: 'front', origin: 'uploaded', order: 0 }] })
      .where(eq(character.id, mine));

    const before = await testDb.db.select().from(character).where(eq(character.channelId, target));
    const result = await installer.install(
      'local',
      request(key, {
        name: 'Slots',
        bindings: {
          [report.slots.find((s) => s.kind === 'asset')!.key]: { existing: myAsset },
          [report.slots.find((s) => s.kind === 'character')!.key]: { existing: mine },
        },
      }),
    );
    expect(result.runnable).toBe(true);
    const after = await testDb.db.select().from(character).where(eq(character.channelId, target));
    expect(after).toHaveLength(before.length); // nothing new was created
    const [version] = await testDb.db
      .select()
      .from(blueprintVersion)
      .where(eq(blueprintVersion.id, result.blueprintVersionId));
    expect(
      (version!.roles as Array<{ characterId: string; referenceBlobIds: string[] }>)[0],
    ).toMatchObject({
      characterId: mine,
      referenceBlobIds: [myRef],
    });
    expect(JSON.stringify(version!.graph)).toContain(myAsset);

    // an asset of another channel is refused
    const other = await upload(
      await exportZip(src.versionId, { [src.assetId]: 'slot', [src.characterId]: 'slot' }),
    );
    await expect(
      installer.install(
        'local',
        request(other, {
          name: 'Wrong channel',
          bindings: {
            [report.slots.find((s) => s.kind === 'asset')!.key]: { existing: src.assetId },
            [report.slots.find((s) => s.kind === 'character')!.key]: { existing: mine },
          },
        }),
      ),
    ).rejects.toThrow(/not in this channel/);
  });

  it('rolls back and queues the media it wrote when the install fails part-way', async () => {
    const key = await upload(await exportZip());
    const charactersBefore = await testDb.db
      .select()
      .from(character)
      .where(eq(character.channelId, target));
    const orphansBefore = await testDb.db.select().from(storageOrphan);

    // "Imported Shorts" exists, so the transaction fails after the media is stored.
    await expect(installer.install('local', request(key))).rejects.toMatchObject({ status: 409 });

    const charactersAfter = await testDb.db
      .select()
      .from(character)
      .where(eq(character.channelId, target));
    expect(charactersAfter).toHaveLength(charactersBefore.length);
    const orphans = await testDb.db
      .select()
      .from(storageOrphan)
      .where(eq(storageOrphan.reason, 'package_import_failed'));
    expect(orphans.length).toBeGreaterThan(0);
    expect((await testDb.db.select().from(storageOrphan)).length).toBeGreaterThan(
      orphansBefore.length,
    );
    // a failed install keeps the upload, so the user can fix the name and retry
    expect(await orphanReasons(key)).toEqual([]);
    await expect(
      installer.install('local', request(key, { name: 'Retry works' })),
    ).resolves.toBeDefined();
  });

  it('only lets a package from the same signer update an installed one', async () => {
    const before = await identity.status();
    if (before.status !== 'ready') throw new Error('expected an identity');
    await identity.regenerate();
    const key = await upload(await exportZip());
    const { report } = await inspector.inspect('local', key, target);
    expect(report.signer).toMatchObject({ signed: true, own: true });
    expect(report.signer.fingerprint).not.toBe(before.identity.fingerprint);
    // the blueprint in the channel was imported under the old key
    expect(report.installed).toMatchObject({ relation: 'other-signer', canUpdate: false });

    const installedId = report.installed!.blueprintId;
    await expect(
      installer.install('local', request(key, { mode: 'update', targetBlueprintId: installedId })),
    ).rejects.toMatchObject({ status: 400 });

    // it can still be installed as a separate copy
    const copy = await installer.install('local', request(key, { name: 'Signed by the new key' }));
    const [row] = await testDb.db
      .select()
      .from(packageImport)
      .where(eq(packageImport.blueprintId, copy.blueprintId));
    expect(row?.authorFingerprint).toBe(report.signer.fingerprint);
  });
});
