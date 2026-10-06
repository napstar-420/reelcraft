import { eq } from 'drizzle-orm';
import type { StageDef } from '@reelcraft/shared';
import { ulid } from '../../src/common/ulid';
import {
  asset,
  blob,
  blueprint,
  blueprintVersion,
  channel,
  character,
} from '../../src/db/schema/index';
import { sha256Hex } from '../../src/package/package-signing';
import type { StorageAdapter } from '../../src/storage/storage.adapter';
import type { TestDb } from './test-db';

/** A file that starts like a real PNG, so import's media sniffing accepts it. */
export const pngBytes = (label: string): Buffer =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(label),
  ]);

export interface SourceIds {
  channelId: string;
  assetId: string;
  characterId: string;
  blueprintId: string;
  versionId: string;
  refA: string;
  refB: string;
}

export function textStage(over: Partial<StageDef> = {}): StageDef {
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

export async function seedBlob(
  testDb: TestDb,
  storage: StorageAdapter,
  key: string,
  body: Buffer,
  scope: 'asset' | 'character',
  characterId?: string,
): Promise<string> {
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

export async function seedChannel(testDb: TestDb, name: string): Promise<string> {
  const id = ulid();
  await testDb.db.insert(channel).values({ id, ownerId: 'local', name });
  return id;
}

/** A channel with an asset, a character with two references, and a runnable
 * blueprint version that uses them: the asset inside a `coalesce`, the
 * character as a role that selects one reference. */
export async function seedSource(
  testDb: TestDb,
  storage: StorageAdapter,
  options: { withEmail?: boolean } = {},
): Promise<SourceIds> {
  const db = testDb.db;
  const channelId = await seedChannel(testDb, `Source ${ulid()}`);

  const assetBlob = await seedBlob(
    testDb,
    storage,
    `local/${channelId}/assets/logo.png`,
    pngBytes('logo'),
    'asset',
  );
  const assetId = ulid();
  await db
    .insert(asset)
    .values({ id: assetId, channelId, name: 'Logo', kind: 'media.image', blobId: assetBlob });

  const characterId = ulid();
  await db.insert(character).values({
    id: characterId,
    channelId,
    scope: 'channel',
    name: 'Host',
    description: 'A friendly host',
    readiness: 'ready',
  });
  const refA = await seedBlob(
    testDb,
    storage,
    `local/characters/${characterId}/refs/a.png`,
    pngBytes('ref-a'),
    'character',
    characterId,
  );
  const refB = await seedBlob(
    testDb,
    storage,
    `local/characters/${characterId}/refs/b.png`,
    pngBytes('ref-b'),
    'character',
    characterId,
  );
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
      textStage({
        slots: {
          logo: {
            from: 'coalesce',
            refs: [
              { from: 'asset', assetId },
              { from: 'const', value: 'none' },
            ],
          },
        },
        context: { who: { from: 'role', roleKey: 'host' } },
        attach: ['who'],
        config: options.withEmail === false ? {} : { accounts: ['me@example.com'] },
        model: { provider: 'fake', modelId: 'fake-text-vision' },
      }),
    ],
    inputs: [],
    roles: [{ key: 'host', label: 'Host', required: true, characterId, referenceBlobIds: [refA] }],
    defaults: {},
    budget: { runCapUsd: 5 },
    validation: [],
    runnable: true,
  });
  await db
    .update(blueprint)
    .set({ currentVersionId: versionId })
    .where(eq(blueprint.id, blueprintId));
  return { channelId, assetId, characterId, blueprintId, versionId, refA, refB };
}
