import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { StorageModule } from '../storage/storage.module';
import { ChannelService } from './channel.service';
import { ChannelController } from './channel.controller';
import { AssetService } from './asset.service';
import { AssetController } from './asset.controller';
import { ArtifactModule } from '../artifact/artifact.module';
import { CharacterService } from './character.service';
import { CharacterController } from './character.controller';

@Module({
  imports: [DbModule, StorageModule, ArtifactModule],
  providers: [ChannelService, AssetService, CharacterService],
  controllers: [ChannelController, AssetController, CharacterController],
  exports: [ChannelService, AssetService, CharacterService],
})
export class ChannelModule {}
