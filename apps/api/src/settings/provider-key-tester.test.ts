import { describe, expect, it, vi } from 'vitest';
import { testProviderKey } from './provider-key-tester';

const reply = (status: number) => ({ ok: status < 300, status }) as Response;

describe('testProviderKey for ElevenLabs', () => {
  it('passes a key that can do everything', async () => {
    const fetch = vi.fn().mockResolvedValue(reply(200));
    expect(await testProviderKey('elevenlabs', 'k', fetch)).toEqual({ ok: true });
  });

  it('warns, and names the permission, when the key cannot list voices', async () => {
    const fetch = vi.fn(async (url: string | URL | Request, _init?: RequestInit) =>
      reply(String(url).includes('/v2/voices') ? 401 : 200),
    );
    const result = await testProviderKey('elevenlabs', 'k', fetch);
    expect(result.ok).toBe(true);
    expect(result.warning).toMatch(/Voices: Read/);
    expect(result.warning).not.toMatch(/Pronunciation/);
  });

  it('still rejects a key ElevenLabs does not accept', async () => {
    const fetch = vi.fn().mockResolvedValue(reply(401));
    expect(await testProviderKey('elevenlabs', 'k', fetch)).toEqual({
      ok: false,
      error: 'The provider rejected this key.',
    });
  });
});
