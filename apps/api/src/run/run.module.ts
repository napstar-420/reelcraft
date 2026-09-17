import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { CapabilityModule } from '../capability/capability.module';
import { OrchestrationModule } from '../orchestration/orchestration.module';
import { RunConfigModule } from '../run-config/run-config.module';
import { BudgetModule } from '../budget/budget.module';
import { RunService } from './run.service';
import { RunController } from './run.controller';

@Module({
  imports: [DbModule, CapabilityModule, OrchestrationModule, RunConfigModule, BudgetModule],
  providers: [RunService],
  controllers: [RunController],
  exports: [RunService],
})
export class RunModule {}
