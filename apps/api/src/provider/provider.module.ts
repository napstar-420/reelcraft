import { Module, type OnModuleInit } from '@nestjs/common';
import { KEY_PROVIDER, EnvKeyProvider } from './key-provider';
import { ProviderRegistry } from './provider.registry';
import { FakeProviderAdapter } from './fake/fake-provider.adapter';
import { OpenRouterAdapter } from './openrouter/openrouter.adapter';
import { ModelCacheService } from './openrouter/model-cache.service';

@Module({
  providers: [
    { provide: KEY_PROVIDER, useClass: EnvKeyProvider },
    ProviderRegistry,
    FakeProviderAdapter,
    OpenRouterAdapter,
    ModelCacheService,
  ],
  exports: [ProviderRegistry, FakeProviderAdapter, OpenRouterAdapter],
})
export class ProviderModule implements OnModuleInit {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly fake: FakeProviderAdapter,
    private readonly openrouter: OpenRouterAdapter,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.fake);
    this.registry.register(this.openrouter);
  }
}
