import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { LiveEvents } from './live-events';
import { LiveGateway } from './live.gateway';
import { LivePresence } from './live-presence';

/** Must never be imported by CapabilityModule (it imports DbModule). */
@Module({
  imports: [DbModule],
  providers: [LiveEvents, LiveGateway, LivePresence],
  exports: [LiveEvents, LivePresence],
})
export class LiveModule {}
