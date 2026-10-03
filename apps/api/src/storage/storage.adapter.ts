import type { Readable } from 'node:stream';
import type { ByteRange, PutResult } from '@reelcraft/shared';

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
  /** Browser-facing by default, so the URL may be relative to this app's
   * origin (see `S3_BROWSER_PATH_PREFIX`). Pass `external` when a third
   * party fetches the URL and needs it absolute. */
  presignGet(key: string, ttlSec: number, options?: PresignOptions): Promise<string>;
  presignPut(key: string, ttlSec: number): Promise<string>;
  /** One level of the key tree under `prefix` (which ends in `/`): the
   * object keys directly in it and the sub-prefixes ("folders") below it. */
  list(prefix: string): Promise<{ keys: string[]; prefixes: string[] }>;
  /** Every object key under `prefix`, at any depth. */
  listAll(prefix: string): Promise<string[]>;
}

export interface PresignOptions {
  external?: boolean;
}

export const STORAGE_ADAPTER = Symbol('STORAGE_ADAPTER');
