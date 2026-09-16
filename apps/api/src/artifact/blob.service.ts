import { Inject, Injectable } from '@nestjs/common';
import { STORAGE_ADAPTER, type StorageAdapter } from '../storage/storage.adapter';
import { ulid } from '../common/ulid';
import { redactSecrets } from '../common/redact-secrets';
import { objectKey } from '../storage/object-key';

/** Thin wrapper over StorageAdapter for the object-key conventions §4.3
 * defines — raw provider responses, in particular, always go through
 * redactSecrets() before being written. */
@Injectable()
export class BlobService {
  constructor(@Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter) {}

  async writeRawResponse(params: {
    ownerId: string;
    channelId: string;
    runId: string;
    attemptId: string;
    payload: unknown;
  }): Promise<string> {
    const key = objectKey.rawResponse(
      params.ownerId,
      params.channelId,
      params.runId,
      params.attemptId,
    );
    const body = Buffer.from(JSON.stringify(redactSecrets(params.payload)));
    await this.storage.put(key, body, { mime: 'application/json' });
    return key;
  }

  newBlobId(): string {
    return ulid();
  }
}
