import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import type { ByteRange, PutResult } from '@reefcraft/shared';
import type { StorageAdapter } from '../../src/storage/storage.adapter';

interface StoredObject {
  body: Buffer;
  mime: string;
}

/**
 * In-memory `StorageAdapter` for e2e tests. Only `BlobService.writeRawResponse`
 * (a `put()` call) is exercised anywhere in the current test surface, but
 * every method is implemented for real rather than stubbed, so a future
 * suite touching presigned URLs or downloads doesn't need this revisited.
 *
 * Without this, e2e tests depend on a real S3/MinIO round trip via
 * `S3StorageAdapter` — which only ever worked because docker-compose's
 * MinIO happens to be running locally, exactly the same "works locally by
 * accident, breaks with only a bare Postgres in CI" gap `build-app.ts`
 * already closes for the Inngest client.
 */
export class MemoryStorageAdapter implements StorageAdapter {
  private readonly objects = new Map<string, StoredObject>();

  async put(key: string, body: Buffer | Readable, meta: { mime: string }): Promise<PutResult> {
    const buffer = Buffer.isBuffer(body) ? body : await streamToBuffer(body);
    this.objects.set(key, { body: buffer, mime: meta.mime });
    return { key, etag: hashOf(buffer), bytes: buffer.byteLength };
  }

  async getStream(key: string, range?: ByteRange): Promise<Readable> {
    const object = this.requireObject(key);
    const body = range
      ? object.body.subarray(range.start, range.end !== undefined ? range.end + 1 : undefined)
      : object.body;
    return Readable.from(body);
  }

  async stat(key: string): Promise<{ bytes: number; etag: string; mime: string }> {
    const object = this.requireObject(key);
    return { bytes: object.body.byteLength, etag: hashOf(object.body), mime: object.mime };
  }

  async copy(srcKey: string, destKey: string): Promise<PutResult> {
    const object = this.requireObject(srcKey);
    this.objects.set(destKey, { ...object });
    return { key: destKey, etag: hashOf(object.body), bytes: object.body.byteLength };
  }

  async delete(keys: string[]): Promise<void> {
    for (const key of keys) this.objects.delete(key);
  }

  async presignGet(key: string): Promise<string> {
    return `memory://${key}`;
  }

  async presignPut(key: string): Promise<string> {
    return `memory://${key}`;
  }

  private requireObject(key: string): StoredObject {
    const object = this.objects.get(key);
    if (!object) throw new Error(`MemoryStorageAdapter: no object at key "${key}"`);
    return object;
  }
}

function hashOf(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
