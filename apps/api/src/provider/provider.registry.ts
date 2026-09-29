import { Injectable, Logger } from '@nestjs/common';
import type { ProviderAdapter } from './provider-adapter.interface';

/** Providers whose stage pins are checked against live model discovery at save and run start. */
export const PINNED_PROVIDERS: ReadonlySet<string> = new Set(['codex', 'chatgpt', 'openrouter']);
export const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  codex: 'Codex',
  chatgpt: 'ChatGPT',
  openrouter: 'OpenRouter',
};

@Injectable()
export class ProviderRegistry {
  private readonly logger = new Logger(ProviderRegistry.name);
  private readonly adapters = new Map<string, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`ProviderRegistry: duplicate provider id "${adapter.id}"`);
    }
    this.adapters.set(adapter.id, adapter);
    this.logger.log(
      { providerId: adapter.id, modalities: adapter.modalities },
      'provider registered',
    );
  }

  get(providerId: string): ProviderAdapter {
    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      this.logger.warn({ providerId }, 'unknown provider requested');
      throw new Error(`ProviderRegistry: unknown provider "${providerId}"`);
    }
    return adapter;
  }

  list(): string[] {
    return [...this.adapters.keys()];
  }
}
