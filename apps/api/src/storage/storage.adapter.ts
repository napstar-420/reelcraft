import type { Readable } from 'node:stream';
import type { ByteRange, PutResult } from '@reefcraft/shared';

/**
 * §4.3 — behavioral interface, intentionally not in packages/shared
 * (Appendix A.2). `forcePathStyle: true` is mandatory for the MinIO
 * implementation — see S3StorageAdapter.
 */
export interface StorageAdapter {
  put(key: string, body: Buffer | Readable, meta: { mime: string }): Promise<PutResult>;
  getStream(key: string, range?: ByteRange): Promise<Readable>;
  stat(key: string): Promise<{ bytes: number; etag: string; mime: string }>;
  copy(srcKey: string, destKey: string): Promise<PutResult>;
  delete(keys: string[]): Promise<void>;
  presignGet(key: string, ttlSec: number): Promise<string>;
  presignPut(key: string, ttlSec: number): Promise<string>;
}

export const STORAGE_ADAPTER = Symbol('STORAGE_ADAPTER');
