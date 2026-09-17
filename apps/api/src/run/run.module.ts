import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { CapabilityModule } from '../capability/capability.module';
import { OrchestrationModule } from '../orchestration/orchestration.module';
import { RunConfigModule } from '../run-config/run-config.module';
import { BudgetModule } from '../budget/budget.module';
import { StorageModule } from '../storage/storage.module';
import { JsonSchemaModule } from '../json-schema/json-schema.module';
import { ArtifactModule } from '../artifact/artifact.module';
import { RunService } from './run.service';
import { RunInputService } from './run-input.service';
import { RunController } from './run.controller';

@Module({
  imports: [
    DbModule,
    CapabilityModule,
    OrchestrationModule,
    RunConfigModule,
    BudgetModule,
    StorageModule,
    JsonSchemaModule,
    ArtifactModule,
  ],
  providers: [RunService, RunInputService],
  controllers: [RunController],
  exports: [RunService, RunInputService],
})
export class RunModule {}
