import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { StorageModule } from '../storage/storage.module';
import { ArtifactService } from './artifact.service';
import { BlobService } from './blob.service';
import { BindingResolverService } from './binding-resolver.service';
import { DerivedFrameService } from './derived-frame.service';
import { MemoryService } from './memory.service';
import { MediaProbeService } from './media-probe.service';
import { MediaArtifactService } from './media-artifact.service';
import { BlobController } from './blob.controller';
import { TimelineHandleService } from './timeline-handle.service';
import { TimelineResourceResolverService } from './timeline-resource-resolver.service';
import { FileArtifactService } from './file-artifact.service';
import { ArtifactAttachmentService } from './artifact-attachment.service';

@Module({
  imports: [DbModule, StorageModule],
  providers: [
    ArtifactService,
    BlobService,
    BindingResolverService,
    DerivedFrameService,
    MemoryService,
    MediaProbeService,
    MediaArtifactService,
    TimelineHandleService,
    TimelineResourceResolverService,
    FileArtifactService,
    ArtifactAttachmentService,
  ],
  controllers: [BlobController],
  exports: [
    ArtifactService,
    BlobService,
    BindingResolverService,
    DerivedFrameService,
    MemoryService,
    MediaProbeService,
    MediaArtifactService,
    TimelineHandleService,
    TimelineResourceResolverService,
    FileArtifactService,
    ArtifactAttachmentService,
  ],
})
export class ArtifactModule {}
