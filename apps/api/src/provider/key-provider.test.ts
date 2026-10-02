import { describe, expect, it } from 'vitest';
import type { SettingsService } from '../settings/settings.service';
import { SettingsKeyProvider } from './key-provider';

function provider(saved: Record<string, string | 'unreadable'>, env: NodeJS.ProcessEnv = {}) {
  const settings = {
    getSecret: async (key: string) => {
      const value = saved[key];
      if (value === 'unreadable') return { value: null, unreadable: true };
      return value ? { value, unreadable: false } : { value: null, unreadable: false };
    },
  } as unknown as SettingsService;
  return new SettingsKeyProvider(settings, env);
}

describe('SettingsKeyProvider', () => {
  it('prefers the container environment over a saved key', async () => {
    const keys = provider({ 'providerKey.fal': 'saved-key' }, { FAL_KEY: 'env-key' });
    await expect(keys.resolve('fal')).resolves.toEqual({
      value: 'env-key',
      source: 'env',
      unreadable: false,
    });
  });

  it('falls back to the key saved in Settings', async () => {
    const keys = provider({ 'providerKey.openrouter': 'saved-key' }, { OPENROUTER_API_KEY: '' });
    await expect(keys.get('openrouter')).resolves.toBe('saved-key');
    await expect(keys.resolve('openrouter')).resolves.toMatchObject({ source: 'saved' });
  });

  it('reports missing and unreadable keys', async () => {
    const keys = provider({ 'providerKey.deepgram': 'unreadable' });
    await expect(keys.get('elevenlabs')).resolves.toBeUndefined();
    await expect(keys.resolve('deepgram')).resolves.toEqual({
      value: undefined,
      source: null,
      unreadable: true,
    });
  });

  it('knows nothing about other providers', async () => {
    const keys = provider({}, { SOMETHING: 'x' });
    await expect(keys.get('fake')).resolves.toBeUndefined();
  });
});
