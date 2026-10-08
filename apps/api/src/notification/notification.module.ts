import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { LiveModule } from '../live/live.module';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

/** Must never import RunModule: the run services import this module. */
@Module({
  imports: [DbModule, LiveModule],
  providers: [NotificationService],
  controllers: [NotificationController],
  exports: [NotificationService],
})
export class NotificationModule {}
