import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { CapabilityModule } from '../capability/capability.module';
import { ArtifactModule } from '../artifact/artifact.module';
import { BudgetModule } from '../budget/budget.module';
import { RunConfigModule } from '../run-config/run-config.module';
import { JsonSchemaModule } from '../json-schema/json-schema.module';
import { CheckModule } from '../check/check.module';
import { QcModule } from '../qc/qc.module';
import { inngestClientProvider } from './inngest.client';
import { StageRunnerService } from './stage-runner.service';
import { RunStateService } from './run-state.service';
import { InProcessRunEvents } from './run-events';
import { HumanWaitService } from '../run/human-wait.service';

@Module({
  imports: [
    DbModule,
    CapabilityModule,
    ArtifactModule,
    BudgetModule,
    RunConfigModule,
    JsonSchemaModule,
    CheckModule,
    QcModule,
  ],
  providers: [
    inngestClientProvider,
    StageRunnerService,
    RunStateService,
    InProcessRunEvents,
    HumanWaitService,
  ],
  exports: [
    inngestClientProvider,
    StageRunnerService,
    RunStateService,
    InProcessRunEvents,
    HumanWaitService,
  ],
})
export class OrchestrationModule {}
