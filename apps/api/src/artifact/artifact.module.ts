import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { StorageModule } from '../storage/storage.module';
import { ArtifactService } from './artifact.service';
import { BlobService } from './blob.service';
import { BindingResolverService } from './binding-resolver.service';
import { MemoryService } from './memory.service';

@Module({
  imports: [DbModule, StorageModule],
  providers: [ArtifactService, BlobService, BindingResolverService, MemoryService],
  exports: [ArtifactService, BlobService, BindingResolverService, MemoryService],
})
export class ArtifactModule {}
