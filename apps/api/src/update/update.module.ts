import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { UpdateAgentClient } from './update-agent.client';
import { UpdateController } from './update.controller';

@Module({
  imports: [DbModule],
  providers: [UpdateAgentClient],
  controllers: [UpdateController],
})
export class UpdateModule {}
