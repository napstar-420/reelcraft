import type { ConnectionTestDto, ProviderKeyId } from '@reelcraft/shared';

type Check = {
  url: string;
  headers: (key: string) => Record<string, string>;
  /** Further requests that only need to succeed for part of Reelcraft: a failure is a warning. */
  extras?: { url: string; needs: string }[];
};

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
    // A restricted key can pass the check above and still lack these.
    extras: [
      {
        url: 'https://api.elevenlabs.io/v2/voices?page_size=1',
        needs: 'list voices (Voices: Read)',
      },
      {
        url: 'https://api.elevenlabs.io/v1/pronunciation-dictionaries?page_size=1',
        needs: 'list pronunciation dictionaries (Pronunciation Dictionaries: Read)',
      },
    ],
  },
  deepgram: {
    url: 'https://api.deepgram.com/v1/projects',
    headers: (key) => ({ authorization: `Token ${key}` }),
  },
};

const PROVIDER_NAMES: Partial<Record<ProviderKeyId, string>> = { elevenlabs: 'ElevenLabs' };

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
    if (res.ok) {
      const missing: string[] = [];
      for (const extra of check.extras ?? []) {
        try {
          const probe = await fetchImpl(extra.url, {
            headers: { accept: 'application/json', ...check.headers(key) },
            signal: AbortSignal.timeout(10_000),
          });
          if (probe.status === 401 || probe.status === 403) missing.push(extra.needs);
        } catch {
          // An extra that can't be reached says nothing about the key.
        }
      }
      return missing.length
        ? {
            ok: true,
            warning: `The key works, but it can't ${missing.join(' or ')}. Add the permission to the key in ${PROVIDER_NAMES[id] ?? 'the provider'}, or create a new key without restrictions. Until then the voice picker asks you to paste a voice ID.`,
          }
        : { ok: true };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'The provider rejected this key.' };
    }
    return { ok: false, error: `The provider answered HTTP ${res.status}.` };
  } catch (error) {
    return { ok: false, error: `Could not reach the provider: ${(error as Error).message}` };
  }
}
