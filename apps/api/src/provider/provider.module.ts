import { Module, type OnModuleInit } from '@nestjs/common';
import { KEY_PROVIDER, SettingsKeyProvider } from './key-provider';
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
import { SETTING, SettingsService } from '../settings/settings.service';
import { SettingsModule } from '../settings/settings.module';
import { CodexAppServerClient } from './codex/codex-app-server.client';
import { CodexJobLauncher } from './codex/codex-job-launcher';
import { CodexProviderAdapter } from './codex/codex-provider.adapter';
import { CodexRuntimeReadiness } from './codex/codex-runtime-readiness';
import { CodexInputMaterializer } from './codex/codex-input-materializer';
import { NeoClient } from './chatgpt/neo-client';
import { CodexLoginService } from './codex/codex-login.service';
import { CodexNeoRegistrar } from './codex/codex-neo-registrar';
import { ChatgptProviderAdapter } from './chatgpt/chatgpt-provider.adapter';

@Module({
  imports: [DbModule, StorageModule, SettingsModule],
  providers: [
    {
      provide: SettingsKeyProvider,
      inject: [SettingsService],
      useFactory: (settings: SettingsService) => new SettingsKeyProvider(settings),
    },
    { provide: KEY_PROVIDER, useExisting: SettingsKeyProvider },
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
    NeoClient,
    ChatgptProviderAdapter,
    {
      provide: CodexNeoRegistrar,
      inject: [EngineConfig, SettingsService],
      useFactory: (config: EngineConfig, settings: SettingsService) =>
        new CodexNeoRegistrar(config, settings),
    },
    {
      provide: CodexLoginService,
      inject: [NeoClient, CodexAppServerClient, CodexRuntimeReadiness, CodexNeoRegistrar],
      useFactory: (
        neo: NeoClient,
        models: CodexAppServerClient,
        readiness: CodexRuntimeReadiness,
        registrar: CodexNeoRegistrar,
      ) => new CodexLoginService(neo, models, readiness, registrar),
    },
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
    SettingsKeyProvider,
    NeoClient,
    CodexAppServerClient,
    CodexRuntimeReadiness,
    CodexNeoRegistrar,
    CodexLoginService,
    ProviderRegistry,
    FakeProviderAdapter,
    OpenRouterAdapter,
    ElevenLabsAdapter,
    FalAdapter,
    DeepgramAdapter,
    CodexProviderAdapter,
    ChatgptProviderAdapter,
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
    private readonly chatgpt: ChatgptProviderAdapter,
    private readonly settings: SettingsService,
    private readonly openrouterModels: ModelCacheService,
    private readonly codexReadiness: CodexRuntimeReadiness,
  ) {}

  onModuleInit(): void {
    this.settings.onChange((key) => {
      if (key === SETTING.providerKey('openrouter')) this.openrouterModels.clear();
      if (key === SETTING.browserOsUrl) {
        this.chatgpt.forgetReadiness();
        this.codexReadiness.reset();
      }
    });
    this.registry.register(this.fake);
    this.registry.register(this.openrouter);
    this.registry.register(this.elevenlabs);
    this.registry.register(this.fal);
    this.registry.register(this.deepgram);
    this.registry.register(this.codex);
    this.registry.register(this.chatgpt);
  }
}
