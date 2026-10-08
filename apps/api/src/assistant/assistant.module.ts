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
import { AssistantController } from './assistant.controller';
import { AssistantEvents } from './assistant-events';
import { AssistantService } from './assistant.service';
import { ASSISTANT_AGENTS } from './agent/assistant-agent.interface';
import { CodexAssistantAgent } from './agent/codex-assistant.agent';
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
  ],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    AssistantEvents,
    // Codex first; a Claude agent would be added to this list.
    {
      provide: ASSISTANT_AGENTS,
      inject: [CodexAppServerClient, CodexNeoRegistrar],
      useFactory: (models: CodexAppServerClient, registrar: CodexNeoRegistrar) => [
        new CodexAssistantAgent({ models, registrar }),
      ],
    },
  ],
})
export class AssistantModule {}
