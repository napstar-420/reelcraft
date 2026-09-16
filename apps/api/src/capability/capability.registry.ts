import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { CAPABILITY_KEY_METADATA } from './capability.decorator';
import type { CapabilityImpl } from './capability.interface';

/**
 * §7.1 — scans for the metadata key at bootstrap, throws on duplicates.
 * Backs GET /capabilities, so editor form generation, validator type
 * checking, and execution all read one source.
 */
@Injectable()
export class CapabilityRegistry implements OnModuleInit {
  private readonly capabilities = new Map<string, CapabilityImpl>();

  constructor(private readonly discovery: DiscoveryService) {}

  onModuleInit(): void {
    const providers = this.discovery.getProviders();
    for (const wrapper of providers) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;
      const key = Reflect.getMetadata(CAPABILITY_KEY_METADATA, metatype) as string | undefined;
      if (!key) continue;
      if (this.capabilities.has(key)) {
        throw new Error(`CapabilityRegistry: duplicate capability key "${key}"`);
      }
      this.capabilities.set(key, instance as CapabilityImpl);
    }
  }

  get(key: string): CapabilityImpl {
    const capability = this.capabilities.get(key);
    if (!capability) {
      throw new Error(`CapabilityRegistry: unknown capability "${key}"`);
    }
    return capability;
  }

  list(): Array<{ key: string; impl: CapabilityImpl }> {
    return [...this.capabilities.entries()].map(([key, impl]) => ({ key, impl }));
  }
}
