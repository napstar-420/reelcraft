import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { BlueprintModule } from '../blueprint/blueprint.module';
import { CapabilityModule } from '../capability/capability.module';
import { ProviderModule } from '../provider/provider.module';
import { ChannelModule } from '../channel/channel.module';
import { JsonSchemaModule } from '../json-schema/json-schema.module';
import { AssistantController } from './assistant.controller';
import { AssistantEvents } from './assistant-events';
import { AssistantService } from './assistant.service';
import { ASSISTANT_AGENTS } from './agent/assistant-agent.interface';

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
  ],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    AssistantEvents,
    // No agent is registered yet; the Codex agent is added in a following change.
    { provide: ASSISTANT_AGENTS, useValue: [] },
  ],
})
export class AssistantModule {}
