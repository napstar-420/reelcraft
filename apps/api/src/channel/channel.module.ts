import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { StorageModule } from '../storage/storage.module';
import { ChannelService } from './channel.service';
import { ChannelController } from './channel.controller';
import { AssetService } from './asset.service';
import { AssetController } from './asset.controller';
import { ArtifactModule } from '../artifact/artifact.module';

@Module({
  imports: [DbModule, StorageModule, ArtifactModule],
  providers: [ChannelService, AssetService],
  controllers: [ChannelController, AssetController],
  exports: [ChannelService, AssetService],
})
export class ChannelModule {}
