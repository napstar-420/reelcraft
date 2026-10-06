import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { LoggingModule } from './common/logging.module';
import { ChannelModule } from './channel/channel.module';
import { BlueprintModule } from './blueprint/blueprint.module';
import { CapabilityModule } from './capability/capability.module';
import { CheckModule } from './check/check.module';
import { QcModule } from './qc/qc.module';
import { RunModule } from './run/run.module';
import { SystemModule } from './system/system.module';
import { UpdateModule } from './update/update.module';
import { PackageModule } from './package/package.module';
import { SettingsPageModule } from './settings/settings-page.module';

@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    ChannelModule,
    BlueprintModule,
    CapabilityModule,
    CheckModule,
    QcModule,
    RunModule,
    SystemModule,
    UpdateModule,
    SettingsPageModule,
    PackageModule,
  ],
})
export class AppModule {}
