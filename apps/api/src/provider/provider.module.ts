import { Module, type OnModuleInit } from '@nestjs/common';
import { KEY_PROVIDER, EnvKeyProvider } from './key-provider';
import { ProviderRegistry } from './provider.registry';
import { FakeProviderAdapter } from './fake/fake-provider.adapter';
import { OpenRouterAdapter } from './openrouter/openrouter.adapter';
import { ModelCacheService } from './openrouter/model-cache.service';
import { ElevenLabsAdapter } from './elevenlabs/elevenlabs.adapter';
import { FalAdapter } from './fal/fal.adapter';
import { DeepgramAdapter } from './deepgram/deepgram.adapter';
import { DeepgramInboxService } from './deepgram/deepgram-inbox.service';
import { DeepgramController } from './deepgram/deepgram.controller';
import { DbModule } from '../db/db.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [DbModule, StorageModule],
  providers: [
    { provide: KEY_PROVIDER, useClass: EnvKeyProvider },
    ProviderRegistry,
    FakeProviderAdapter,
    OpenRouterAdapter,
    ModelCacheService,
    ElevenLabsAdapter,
    FalAdapter,
    DeepgramAdapter,
    DeepgramInboxService,
  ],
  controllers: [DeepgramController],
  exports: [ProviderRegistry, FakeProviderAdapter, OpenRouterAdapter, ElevenLabsAdapter, FalAdapter, DeepgramAdapter],
})
export class ProviderModule implements OnModuleInit {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly fake: FakeProviderAdapter,
    private readonly openrouter: OpenRouterAdapter,
    private readonly elevenlabs: ElevenLabsAdapter,
    private readonly fal: FalAdapter,
    private readonly deepgram: DeepgramAdapter,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.fake);
    this.registry.register(this.openrouter);
    this.registry.register(this.elevenlabs);
    this.registry.register(this.fal);
    this.registry.register(this.deepgram);
  }
}
