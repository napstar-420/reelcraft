import { Module } from '@nestjs/common';
import { S3StorageAdapter } from './s3-storage.adapter';
import { STORAGE_ADAPTER } from './storage.adapter';
import { BucketBootstrapService } from './bucket-bootstrap.service';
import { WorkspaceService } from './workspace.service';
import { ComputeJobService } from './compute-job.service';

@Module({
  providers: [
    { provide: STORAGE_ADAPTER, useClass: S3StorageAdapter },
    BucketBootstrapService,
    WorkspaceService,
    ComputeJobService,
  ],
  exports: [STORAGE_ADAPTER, WorkspaceService, ComputeJobService],
})
export class StorageModule {}
