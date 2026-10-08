import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { LiveModule } from '../live/live.module';
import { SettingsModule } from '../settings/settings.module';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { PushController } from './push.controller';
import { PushService } from './push.service';

/** Must never import RunModule: the run services import this module. */
@Module({
  imports: [DbModule, LiveModule, SettingsModule],
  providers: [NotificationService, PushService],
  controllers: [NotificationController, PushController],
  exports: [NotificationService],
})
export class NotificationModule {}
