import { Injectable } from '@nestjs/common';

/**
 * §23/REQ-17.3 — provider API keys behind an interface, never hardcoded or
 * read from process.env at the point of use. Never log or persist raw
 * values without redact-secrets.ts.
 */
export interface KeyProvider {
  get(providerId: string): Promise<string | undefined>;
}

export const KEY_PROVIDER = Symbol('KEY_PROVIDER');

@Injectable()
export class EnvKeyProvider implements KeyProvider {
  async get(providerId: string): Promise<string | undefined> {
    return ({
      openrouter: process.env.OPENROUTER_API_KEY,
      fal: process.env.FAL_KEY,
      elevenlabs: process.env.ELEVENLABS_API_KEY,
      deepgram: process.env.DEEPGRAM_API_KEY,
    } as Record<string, string | undefined>)[providerId];
  }
}
