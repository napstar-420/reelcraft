import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { artifactAttachment, blob } from '../db/schema';
import { STORAGE_ADAPTER, type StorageAdapter } from '../storage/storage.adapter';
import { objectKey } from '../storage/object-key';
import { ulid } from '../common/ulid';

export interface SupportingAttachmentInput {
  role: 'evidence' | 'download';
  localPath?: string;
  mime: string;
  filename: string;
}

@Injectable()
export class ArtifactAttachmentService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  async persist(input: {
    ownerId: string;
    channelId: string;
    runId: string;
    artifactId: string;
    attachments: SupportingAttachmentInput[];
  }): Promise<void> {
    for (const attachment of input.attachments) {
      if (!attachment.localPath) throw new Error('Supporting attachment has no local file');
      const fileStat = await stat(attachment.localPath);
      if (!fileStat.isFile()) throw new Error('Supporting attachment is not a file');
      const bytes = await readFile(attachment.localPath);
      const blobId = ulid();
      const filename = basename(attachment.filename);
      const key = objectKey.attachment(
        input.ownerId,
        input.channelId,
        input.runId,
        blobId,
        filename,
      );
      const put = await this.storage.put(key, createReadStream(attachment.localPath), {
        mime: attachment.mime,
      });
      try {
        await this.db.transaction(async (tx) => {
          await tx.insert(blob).values({
            id: blobId,
            ownerId: input.ownerId,
            scope: 'run',
            runId: input.runId,
            bucket: '',
            objectKey: key,
            mime: attachment.mime,
            bytes: put.bytes,
            etag: put.etag,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          });
          await tx.insert(artifactAttachment).values({
            id: ulid(),
            artifactId: input.artifactId,
            blobId,
            role: attachment.role,
            filename,
            mime: attachment.mime,
          });
        });
      } catch (error) {
        await this.storage.delete([key]);
        throw error;
      }
    }
  }
}
