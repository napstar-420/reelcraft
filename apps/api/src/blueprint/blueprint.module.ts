import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { CapabilityModule } from '../capability/capability.module';
import { JsonSchemaModule } from '../json-schema/json-schema.module';
import { SandboxModule } from '../sandbox/sandbox.module';
import { BlueprintService } from './blueprint.service';
import { BlueprintValidatorService } from './blueprint-validator.service';
import { BlueprintController } from './blueprint.controller';
import { RunConfigModule } from '../run-config/run-config.module';
import { ProviderModule } from '../provider/provider.module';

@Module({
  imports: [
    DbModule,
    CapabilityModule,
    JsonSchemaModule,
    SandboxModule,
    RunConfigModule,
    ProviderModule,
  ],
  providers: [BlueprintService, BlueprintValidatorService],
  controllers: [BlueprintController],
  exports: [BlueprintService, BlueprintValidatorService],
})
export class BlueprintModule {}
