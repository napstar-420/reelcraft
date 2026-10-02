import type { ConnectionTestDto, ProviderKeyId } from '@reelcraft/shared';

type Check = { url: string; headers: (key: string) => Record<string, string> };

/** One cheap authenticated request per provider that has one. fal.ai has
 * no free endpoint that checks a key, so it has no test. */
const CHECKS: Partial<Record<ProviderKeyId, Check>> = {
  openrouter: {
    url: 'https://openrouter.ai/api/v1/key',
    headers: (key) => ({ authorization: `Bearer ${key}` }),
  },
  elevenlabs: {
    url: 'https://api.elevenlabs.io/v1/models',
    headers: (key) => ({ 'xi-api-key': key }),
  },
  deepgram: {
    url: 'https://api.deepgram.com/v1/projects',
    headers: (key) => ({ authorization: `Token ${key}` }),
  },
};

export function isTestable(id: ProviderKeyId): boolean {
  return CHECKS[id] !== undefined;
}

/** Checks that `key` works with the provider. Never includes the key in
 * the result. */
export async function testProviderKey(
  id: ProviderKeyId,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectionTestDto> {
  const check = CHECKS[id];
  if (!check) return { ok: false, error: 'This provider has no connection test.' };
  try {
    const res = await fetchImpl(check.url, {
      headers: { accept: 'application/json', ...check.headers(key) },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'The provider rejected this key.' };
    }
    return { ok: false, error: `The provider answered HTTP ${res.status}.` };
  } catch (error) {
    return { ok: false, error: `Could not reach the provider: ${(error as Error).message}` };
  }
}
