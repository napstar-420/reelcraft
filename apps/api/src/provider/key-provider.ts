import { Injectable, Logger } from '@nestjs/common';

/**
 * §23/REQ-17.3 — provider API keys behind an interface, never hardcoded or
 * read from process.env at the point of use. Never log or persist raw
 * values without redact-secrets.ts.
 */
export interface KeyProvider {
  get(providerId: string): Promise<string | undefined>;
}

export const KEY_PROVIDER = Symbol('KEY_PROVIDER');

const ENV_KEYS: Record<string, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  fal: 'FAL_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
  deepgram: 'DEEPGRAM_API_KEY',
};

@Injectable()
export class EnvKeyProvider implements KeyProvider {
  private readonly logger = new Logger(EnvKeyProvider.name);

  async get(providerId: string): Promise<string | undefined> {
    const envVar = ENV_KEYS[providerId];
    const value = envVar ? process.env[envVar] : undefined;
    if (value) this.logger.debug({ providerId, source: 'env', envVar }, 'provider key resolved');
    else this.logger.warn({ providerId, source: 'env', envVar }, 'provider key missing');
    return value;
  }
}
