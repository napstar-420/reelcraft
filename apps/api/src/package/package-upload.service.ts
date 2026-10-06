import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PackageUploadDto } from '@reelcraft/shared';
import { queueStorageOrphans } from '../artifact/storage-orphans';
import { ulid } from '../common/ulid';
import { EngineConfig } from '../config/engine-config';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { objectKey } from '../storage/object-key';
import { STORAGE_ADAPTER, type StorageAdapter } from '../storage/storage.adapter';
import { PACKAGE_LIMITS } from './package-open';

/** Where a `.reelpack` waits between the browser's upload and the import. The
 * browser PUTs straight to storage, like every other upload (ADR: bytes never
 * pass through the API as a request body). */
@Injectable()
export class PackageUploadService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly config: EngineConfig,
  ) {}

  async request(ownerId: string): Promise<PackageUploadDto> {
    const key = objectKey.packageUpload(ownerId, ulid());
    return {
      objectKey: key,
      uploadUrl: await this.storage.presignPut(key, this.config.presignTtlSec),
    };
  }

  /** The uploaded file, or null if it is over the size limit. Only keys this
   * service issued can be read, never an arbitrary object. */
  async read(ownerId: string, key: string): Promise<Uint8Array | null> {
    this.assertIssued(ownerId, key);
    let size: number;
    try {
      size = (await this.storage.stat(key)).bytes;
    } catch {
      throw new NotFoundException('That upload was not found. Choose the file again.');
    }
    if (size > PACKAGE_LIMITS.zipBytes) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of await this.storage.getStream(key)) {
      chunks.push(Buffer.from(chunk as Buffer));
    }
    return Buffer.concat(chunks);
  }

  /** Queues the upload for the storage sweep. Call when the import is over,
   * whatever the outcome. */
  async discard(ownerId: string, key: string): Promise<void> {
    this.assertIssued(ownerId, key);
    await queueStorageOrphans(this.db, [key], 'package_upload');
  }

  private assertIssued(ownerId: string, key: string): void {
    if (!key.startsWith(`${ownerId}/package-uploads/`) || key.includes('..')) {
      throw new BadRequestException('That is not an uploaded package.');
    }
  }
}
