import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { OrchestrationModule } from '../orchestration/orchestration.module';
import { RunConfigModule } from '../run-config/run-config.module';
import { RunService } from './run.service';
import { RunController } from './run.controller';

@Module({
  imports: [DbModule, OrchestrationModule, RunConfigModule],
  providers: [RunService],
  controllers: [RunController],
  exports: [RunService],
})
export class RunModule {}
