import { ConflictException, NotFoundException } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { appSetting } from '../../src/db/schema/index';
import { KEY_PROVIDER, type KeyProvider } from '../../src/provider/key-provider';
import { SettingsController } from '../../src/settings/settings.controller';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

const KEY = 'sk-or-v1-0123456789abcdef-test';

describe('settings (e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;
  let controller: SettingsController;
  const savedEnv = process.env.OPENROUTER_API_KEY;

  beforeAll(async () => {
    delete process.env.OPENROUTER_API_KEY;
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb);
    controller = testApp.app.get(SettingsController);
  });

  afterEach(() => {
    delete process.env.FAL_KEY;
  });

  afterAll(async () => {
    if (savedEnv !== undefined) process.env.OPENROUTER_API_KEY = savedEnv;
    try {
      await testApp?.close();
    } finally {
      await testDb.teardown();
    }
  });

  it('saves a key encrypted, shows only a hint, and hands it to adapters', async () => {
    const status = await controller.saveKey('openrouter', { value: KEY });
    expect(status).toMatchObject({
      id: 'openrouter',
      configured: true,
      source: 'saved',
      hint: '••••test',
      unreadable: false,
    });
    expect(JSON.stringify(await controller.get())).not.toContain(KEY);

    const [row] = await testDb.db
      .select()
      .from(appSetting)
      .where(eq(appSetting.key, 'providerKey.openrouter'));
    expect(row?.secret).toBe(true);
    expect(row?.value).toMatch(/^v1:/);
    expect(row?.value).not.toContain(KEY);

    const keys = testApp.app.get<KeyProvider>(KEY_PROVIDER);
    await expect(keys.get('openrouter')).resolves.toBe(KEY);
  });

  it('removes a saved key', async () => {
    await controller.saveKey('elevenlabs', { value: 'elevenlabs-key-123456' });
    const status = await controller.deleteKey('elevenlabs');
    expect(status).toMatchObject({ configured: false, source: null, hint: null });
    await expect(testApp.app.get<KeyProvider>(KEY_PROVIDER).get('elevenlabs')).resolves.toBe(
      undefined,
    );
  });

  it('lets the container environment win and refuses to save over it', async () => {
    process.env.FAL_KEY = 'fal-env-key-0123456789';
    const fal = (await controller.get()).keys.find((key) => key.id === 'fal');
    expect(fal).toMatchObject({ configured: true, source: 'env' });
    await expect(controller.saveKey('fal', { value: 'fal-saved-key-123' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('marks a key encrypted with another secret as unreadable', async () => {
    await testDb.db
      .insert(appSetting)
      .values({ key: 'providerKey.deepgram', value: 'v1:AAAA:AAAA:AAAA', secret: true });
    // Saved directly, so wait out the settings cache.
    await new Promise((resolve) => setTimeout(resolve, 5_100));
    const deepgram = (await controller.get()).keys.find((key) => key.id === 'deepgram');
    expect(deepgram).toMatchObject({ configured: false, unreadable: true });
  });

  it('rejects unknown providers', async () => {
    await expect(controller.saveKey('nope', { value: 'whatever-123' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('saves and resets the BrowserOS Neo address', async () => {
    const saved = await controller.saveBrowserOs({ url: 'http://neo.local:9010/mcp' });
    expect(saved).toEqual({ url: 'http://neo.local:9010/mcp', source: 'saved' });
    const reset = await controller.saveBrowserOs({ url: '' });
    expect(reset.source).not.toBe('saved');
  });
});
