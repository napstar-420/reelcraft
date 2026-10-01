import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { SystemController } from './system.controller';

@Module({
  imports: [DbModule],
  controllers: [SystemController],
})
export class SystemModule {}
