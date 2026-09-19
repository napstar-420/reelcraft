import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { StorageModule } from '../storage/storage.module';
import { ArtifactService } from './artifact.service';
import { BlobService } from './blob.service';
import { BindingResolverService } from './binding-resolver.service';
import { MemoryService } from './memory.service';
import { MediaProbeService } from './media-probe.service';
import { MediaArtifactService } from './media-artifact.service';
import { BlobController } from './blob.controller';

@Module({
  imports: [DbModule, StorageModule],
  providers: [ArtifactService, BlobService, BindingResolverService, MemoryService, MediaProbeService, MediaArtifactService],
  controllers: [BlobController],
  exports: [ArtifactService, BlobService, BindingResolverService, MemoryService, MediaProbeService, MediaArtifactService],
})
export class ArtifactModule {}
