import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { CapabilityModule } from '../capability/capability.module';
import { ArtifactModule } from '../artifact/artifact.module';
import { BudgetModule } from '../budget/budget.module';
import { RunConfigModule } from '../run-config/run-config.module';
import { JsonSchemaModule } from '../json-schema/json-schema.module';
import { inngestClientProvider } from './inngest.client';
import { StageRunnerService } from './stage-runner.service';
import { RunStateService } from './run-state.service';
import { InProcessRunEvents } from './run-events';

@Module({
  imports: [
    DbModule,
    CapabilityModule,
    ArtifactModule,
    BudgetModule,
    RunConfigModule,
    JsonSchemaModule,
  ],
  providers: [inngestClientProvider, StageRunnerService, RunStateService, InProcessRunEvents],
  exports: [inngestClientProvider, StageRunnerService, RunStateService, InProcessRunEvents],
})
export class OrchestrationModule {}
