import { Injectable } from '@nestjs/common';
import type { ProviderAdapter } from './provider-adapter.interface';

@Injectable()
export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`ProviderRegistry: duplicate provider id "${adapter.id}"`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  get(providerId: string): ProviderAdapter {
    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      throw new Error(`ProviderRegistry: unknown provider "${providerId}"`);
    }
    return adapter;
  }

  list(): string[] {
    return [...this.adapters.keys()];
  }
}
