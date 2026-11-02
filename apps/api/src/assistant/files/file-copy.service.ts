import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../../db/drizzle.provider';
import { blob } from '../../db/schema/index';
import { ulid } from '../../common/ulid';
import { STORAGE_ADAPTER, type StorageAdapter } from '../../storage/storage.adapter';
import { extOf } from '../attachments/attachment.logic';

/** Copies a stored file to a new key, so the assistant can turn an attachment (or anything a run
 * made) into a Library asset, a Character reference or a run input. The destination's own service
 * then checks the copy and writes its rows, exactly as for an upload. */
@Injectable()
export class FileCopyService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  /** `keyFor(blobId, ext)` names the destination. Returns the new blob id and key, with the
   * source's hash and mime. */
  async copy(
    sourceBlobId: string,
    keyFor: (blobId: string, ext: string) => string,
  ): Promise<{ blobId: string; objectKey: string; sha256: string; mime: string; ext: string }> {
    const [source] = await this.db.select().from(blob).where(eq(blob.id, sourceBlobId)).limit(1);
    if (!source || source.deletedAt) throw new NotFoundException('That file is no longer stored.');
    const ext = extOf(source.objectKey) || 'bin';
    const blobId = ulid();
    const objectKey = keyFor(blobId, ext);
    await this.storage.copy(source.objectKey, objectKey, { mime: source.mime });
    return { blobId, objectKey, sha256: source.sha256, mime: source.mime, ext };
  }
}
