import { Injectable, Logger } from '@nestjs/common';
import type { ProviderKeyId, ProviderKeySource } from '@reelcraft/shared';
import { SETTING, SettingsService } from '../settings/settings.service';

/**
 * §23/REQ-17.3 — provider API keys behind an interface, never hardcoded or
 * read from process.env at the point of use. Never log or persist raw
 * values without redact-secrets.ts.
 */
export interface KeyProvider {
  get(providerId: string): Promise<string | undefined>;
}

export const KEY_PROVIDER = Symbol('KEY_PROVIDER');

/** Providers whose key can be set in the environment or on the Settings page. */
export const PROVIDER_KEYS: Record<ProviderKeyId, { label: string; envVar: string }> = {
  openrouter: { label: 'OpenRouter', envVar: 'OPENROUTER_API_KEY' },
  fal: { label: 'fal.ai', envVar: 'FAL_KEY' },
  elevenlabs: { label: 'ElevenLabs', envVar: 'ELEVENLABS_API_KEY' },
  deepgram: { label: 'Deepgram', envVar: 'DEEPGRAM_API_KEY' },
};

export function isProviderKeyId(id: string): id is ProviderKeyId {
  return Object.hasOwn(PROVIDER_KEYS, id);
}

export type ResolvedKey = {
  value: string | undefined;
  source: ProviderKeySource | null;
  /** A saved key exists but can't be decrypted. */
  unreadable: boolean;
};

/**
 * Resolves a provider key: the container environment first, then a key
 * saved in Settings. Adapters ask on every call, so a key saved in Settings
 * takes effect without a restart.
 */
@Injectable()
export class SettingsKeyProvider implements KeyProvider {
  private readonly logger = new Logger(SettingsKeyProvider.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async get(providerId: string): Promise<string | undefined> {
    const { value, source } = await this.resolve(providerId);
    if (value) this.logger.debug({ providerId, source }, 'provider key resolved');
    else this.logger.warn({ providerId }, 'provider key missing');
    return value;
  }

  async resolve(providerId: string): Promise<ResolvedKey> {
    if (!isProviderKeyId(providerId)) return { value: undefined, source: null, unreadable: false };
    const fromEnv = this.envValue(providerId);
    if (fromEnv) return { value: fromEnv, source: 'env', unreadable: false };
    const saved = await this.settings.getSecret(SETTING.providerKey(providerId));
    if (saved.value) return { value: saved.value, source: 'saved', unreadable: false };
    return { value: undefined, source: null, unreadable: saved.unreadable };
  }

  /** The key set in the container environment, if any. */
  envValue(providerId: ProviderKeyId): string | undefined {
    return this.env[PROVIDER_KEYS[providerId]!.envVar] || undefined;
  }
}
