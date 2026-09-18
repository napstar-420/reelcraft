import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { CapabilityModule } from '../capability/capability.module';
import { OrchestrationModule } from '../orchestration/orchestration.module';
import { RunConfigModule } from '../run-config/run-config.module';
import { BudgetModule } from '../budget/budget.module';
import { StorageModule } from '../storage/storage.module';
import { JsonSchemaModule } from '../json-schema/json-schema.module';
import { ArtifactModule } from '../artifact/artifact.module';
import { CheckModule } from '../check/check.module';
import { RunService } from './run.service';
import { RunInputService } from './run-input.service';
import { RunController } from './run.controller';
import { PreviewTokenService } from './preview-token.service';
import { RunActionPolicy } from './run-action-policy';
import { RunMutationService } from './run-mutation.service';
import { RunWakeupClaimService } from './run-wakeup-claim.service';
import { RunWakeupDispatcher } from './run-wakeup-dispatcher.service';
import { InvalidationService } from './invalidation.service';
import { RunActionService } from './run-action.service';
import { HumanActionService } from './human-action.service';
import { RunCancellationService } from './run-cancellation.service';
import { ArtifactEditService } from './artifact-edit.service';
import { HumanReminderService } from './human-reminder.service';

const runControlProviders = [
  PreviewTokenService,
  RunActionPolicy,
  RunMutationService,
  RunWakeupDispatcher,
  RunWakeupClaimService,
  InvalidationService,
  RunActionService,
  HumanActionService,
  RunCancellationService,
  ArtifactEditService,
  HumanReminderService,
];

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
    CheckModule,
  ],
  providers: [RunService, RunInputService, ...runControlProviders],
  controllers: [RunController],
  exports: [RunService, RunInputService, ...runControlProviders],
})
export class RunModule {}
