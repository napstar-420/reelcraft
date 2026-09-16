import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { ChannelModule } from './channel/channel.module';
import { BlueprintModule } from './blueprint/blueprint.module';
import { TemplateModule } from './template/template.module';
import { CapabilityModule } from './capability/capability.module';
import { CheckModule } from './check/check.module';
import { QcModule } from './qc/qc.module';
import { RunModule } from './run/run.module';

@Module({
  imports: [
    ConfigModule,
    ChannelModule,
    BlueprintModule,
    TemplateModule,
    CapabilityModule,
    CheckModule,
    QcModule,
    RunModule,
  ],
})
export class AppModule {}
