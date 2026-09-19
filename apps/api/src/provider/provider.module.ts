import { Module, type OnModuleInit } from '@nestjs/common';
import { KEY_PROVIDER, EnvKeyProvider } from './key-provider';
import { ProviderRegistry } from './provider.registry';
import { FakeProviderAdapter } from './fake/fake-provider.adapter';
import { OpenRouterAdapter } from './openrouter/openrouter.adapter';
import { ModelCacheService } from './openrouter/model-cache.service';
import { ElevenLabsAdapter } from './elevenlabs/elevenlabs.adapter';
import { FalAdapter } from './fal/fal.adapter';

@Module({
  providers: [
    { provide: KEY_PROVIDER, useClass: EnvKeyProvider },
    ProviderRegistry,
    FakeProviderAdapter,
    OpenRouterAdapter,
    ModelCacheService,
    ElevenLabsAdapter,
    FalAdapter,
  ],
  exports: [ProviderRegistry, FakeProviderAdapter, OpenRouterAdapter, ElevenLabsAdapter, FalAdapter],
})
export class ProviderModule implements OnModuleInit {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly fake: FakeProviderAdapter,
    private readonly openrouter: OpenRouterAdapter,
    private readonly elevenlabs: ElevenLabsAdapter,
    private readonly fal: FalAdapter,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.fake);
    this.registry.register(this.openrouter);
    this.registry.register(this.elevenlabs);
    this.registry.register(this.fal);
  }
}
