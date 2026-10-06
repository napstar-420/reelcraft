import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { appSetting } from '../../src/db/schema/index';
import { IdentityController } from '../../src/package/identity.controller';
import { IdentityService } from '../../src/package/identity.service';
import { generateKeyPair, verifyBytes } from '../../src/package/package-signing';
import { SETTING } from '../../src/settings/settings.service';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

describe('package identity (e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;
  let controller: IdentityController;
  let service: IdentityService;

  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb);
    controller = testApp.app.get(IdentityController);
    service = testApp.app.get(IdentityService);
  });

  afterAll(async () => {
    try {
      await testApp?.close();
    } finally {
      await testDb.teardown();
    }
  });

  it('makes one identity on first use, stores the private key encrypted, and signs with it', async () => {
    const [a, b] = await Promise.all([controller.status(), controller.status()]);
    expect(a).toEqual(b);
    if (a.status !== 'ready') throw new Error('expected a ready identity');
    expect(a.identity.label).toBe('local');

    const [row] = await testDb.db
      .select()
      .from(appSetting)
      .where(eq(appSetting.key, SETTING.packageIdentityPrivateKey));
    expect(row?.secret).toBe(true);
    expect(row?.value).not.toContain('PRIVATE KEY');

    const bytes = Buffer.from('manifest');
    const { signature, author } = await service.sign(bytes);
    expect(author.fingerprint).toBe(a.identity.fingerprint);
    expect(verifyBytes(bytes, signature, author.publicKey)).toBe(true);
  });

  it('backs up and restores an identity, and regenerating changes the fingerprint', async () => {
    const before = await controller.status();
    const backup = await controller.backup();
    const regenerated = await controller.regenerate();
    if (before.status !== 'ready') throw new Error('expected a ready identity');
    expect(regenerated.fingerprint).not.toBe(before.identity.fingerprint);

    const restored = await controller.restore(backup);
    expect(restored.fingerprint).toBe(before.identity.fingerprint);
  });

  it('rejects a restore that is not an Ed25519 private key', async () => {
    await expect(
      controller.restore({ format: 'reelcraft.identity', privateKey: 'nope' }),
    ).rejects.toThrow();
  });

  it('reports an identity it cannot decrypt instead of replacing it', async () => {
    await testDb.db
      .update(appSetting)
      .set({ value: 'v1:garbage:garbage:garbage' })
      .where(eq(appSetting.key, SETTING.packageIdentityPrivateKey));
    expect(await controller.status()).toEqual({ status: 'unreadable' });
    await expect(service.sign(Buffer.from('x'))).rejects.toThrow();
    await controller.regenerate();
    expect((await controller.status()).status).toBe('ready');
  });

  it('trusts and untrusts an author by fingerprint', async () => {
    const { publicKey } = generateKeyPair();
    await service.trust(publicKey);
    await service.trust(publicKey);
    const trusted = await controller.trusted();
    expect(trusted).toHaveLength(1);
    expect(await service.isTrusted(trusted[0]!.fingerprint)).toBe(true);

    await controller.untrust(trusted[0]!.fingerprint);
    expect(await controller.trusted()).toEqual([]);
  });
});
