import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { ReadinessService } from './readiness.service';
import { SystemController } from './system.controller';

@Module({
  imports: [DbModule],
  providers: [ReadinessService],
  controllers: [SystemController],
  exports: [ReadinessService],
})
export class SystemModule {}
