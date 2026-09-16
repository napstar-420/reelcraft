import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { OrchestrationModule } from '../orchestration/orchestration.module';
import { RunService } from './run.service';
import { RunController } from './run.controller';

@Module({
  imports: [DbModule, OrchestrationModule],
  providers: [RunService],
  controllers: [RunController],
  exports: [RunService],
})
export class RunModule {}
