import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { BlueprintModule } from '../blueprint/blueprint.module';
import { CapabilityModule } from '../capability/capability.module';
import { ProviderModule } from '../provider/provider.module';
import { ChannelModule } from '../channel/channel.module';
import { JsonSchemaModule } from '../json-schema/json-schema.module';
import { RunConfigModule } from '../run-config/run-config.module';
import { RunModule } from '../run/run.module';
import { ArtifactModule } from '../artifact/artifact.module';
import { LiveModule } from '../live/live.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { MediaReviewService } from './review/media-review.service';
import { AssistantWatchService } from './watch/assistant-watch.service';
import { AssistantSettingsService } from './watch/assistant-settings.service';
import { UserGuideService } from './user-guide/user-guide.service';
import { AttachmentService } from './attachments/attachment.service';
import { FileCopyService } from './files/file-copy.service';
import { LinkImportService } from './files/link-import.service';
import { BrowserService } from './browser/browser.service';
import { SettingsModule } from '../settings/settings.module';
import { QcModule } from '../qc/qc.module';
import { StorageModule } from '../storage/storage.module';
import { ASSISTANT_AGENTS } from './agent/assistant-agent.interface';
import { CodexAssistantAgent } from './agent/codex-assistant.agent';
import { ClaudeAssistantAgent } from './agent/claude-assistant.agent';
import { EngineConfig } from '../config/engine-config';
import { CodexAppServerClient } from '../provider/codex/codex-app-server.client';
import { CodexNeoRegistrar } from '../provider/codex/codex-neo-registrar';

/** The blueprint assistant: chats, turns and the tools the agent calls. It reads the running
 * app through existing services and writes only proposals; `CapabilityModule` must not import it. */
@Module({
  imports: [
    DbModule,
    BlueprintModule,
    CapabilityModule,
    ProviderModule,
    ChannelModule,
    JsonSchemaModule,
    RunConfigModule,
    RunModule,
    ArtifactModule,
    LiveModule,
    QcModule,
    StorageModule,
    SettingsModule,
  ],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    MediaReviewService,
    AssistantWatchService,
    AssistantSettingsService,
    UserGuideService,
    AttachmentService,
    FileCopyService,
    LinkImportService,
    BrowserService,
    // The order is the default: a new chat starts on the first available agent.
    {
      provide: ASSISTANT_AGENTS,
      inject: [CodexAppServerClient, CodexNeoRegistrar, EngineConfig],
      useFactory: (
        models: CodexAppServerClient,
        registrar: CodexNeoRegistrar,
        config: EngineConfig,
      ) => [
        new CodexAssistantAgent({ models, registrar }),
        new ClaudeAssistantAgent({ workspaceRoot: config.workspaceRoot }),
      ],
    },
  ],
})
export class AssistantModule {}
