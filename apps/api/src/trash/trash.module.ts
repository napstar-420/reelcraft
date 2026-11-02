import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { ChannelModule } from '../channel/channel.module';
import { BlueprintModule } from '../blueprint/blueprint.module';
import { TrashController } from './trash.controller';
import { TrashService } from './trash.service';

@Module({
  imports: [DbModule, ChannelModule, BlueprintModule],
  controllers: [TrashController],
  providers: [TrashService],
  exports: [TrashService],
})
export class TrashModule {}
