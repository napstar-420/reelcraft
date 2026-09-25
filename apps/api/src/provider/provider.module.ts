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
import { EngineConfig } from '../config/engine-config';
import { CodexAppServerClient } from './codex/codex-app-server.client';
import { CodexJobLauncher } from './codex/codex-job-launcher';
import { CodexProviderAdapter } from './codex/codex-provider.adapter';
import { CodexRuntimeReadiness } from './codex/codex-runtime-readiness';
import { CodexInputMaterializer } from './codex/codex-input-materializer';

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
    CodexAppServerClient,
    CodexJobLauncher,
    CodexRuntimeReadiness,
    CodexInputMaterializer,
    {
      provide: CodexProviderAdapter,
      inject: [
        EngineConfig,
        CodexAppServerClient,
        CodexJobLauncher,
        CodexRuntimeReadiness,
        CodexInputMaterializer,
      ],
      useFactory: (
        config: EngineConfig,
        models: CodexAppServerClient,
        launcher: CodexJobLauncher,
        readiness: CodexRuntimeReadiness,
        inputs: CodexInputMaterializer,
      ) => new CodexProviderAdapter(config, models, launcher, readiness, inputs),
    },
  ],
  controllers: [DeepgramController],
  exports: [
    ProviderRegistry,
    FakeProviderAdapter,
    OpenRouterAdapter,
    ElevenLabsAdapter,
    FalAdapter,
    DeepgramAdapter,
    CodexProviderAdapter,
  ],
})
export class ProviderModule implements OnModuleInit {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly fake: FakeProviderAdapter,
    private readonly openrouter: OpenRouterAdapter,
    private readonly elevenlabs: ElevenLabsAdapter,
    private readonly fal: FalAdapter,
    private readonly deepgram: DeepgramAdapter,
    private readonly codex: CodexProviderAdapter,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.fake);
    this.registry.register(this.openrouter);
    this.registry.register(this.elevenlabs);
    this.registry.register(this.fal);
    this.registry.register(this.deepgram);
    this.registry.register(this.codex);
  }
}
