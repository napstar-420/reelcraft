import { Module } from '@nestjs/common';
import { ProviderModule } from '../provider/provider.module';
import { ClaudeController } from './claude.controller';
import { CodexController } from './codex.controller';
import { FlowController } from './flow.controller';
import { SettingsController } from './settings.controller';
import { SettingsModule } from './settings.module';

/** Routes for the Settings page. */
@Module({
  imports: [SettingsModule, ProviderModule],
  controllers: [SettingsController, CodexController, ClaudeController, FlowController],
})
export class SettingsPageModule {}
