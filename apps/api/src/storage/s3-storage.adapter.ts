import type { Readable } from 'node:stream';
import { Injectable, Logger } from '@nestjs/common';
import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ByteRange, PutResult } from '@reelcraft/shared';
import { EngineConfig } from '../config/engine-config';
import type { PresignOptions, StorageAdapter } from './storage.adapter';
import { createS3Client } from './s3-client.factory';

/**
 * §4.3 — `forcePathStyle: true` is mandatory: the SDK defaults to
 * virtual-host addressing, which needs wildcard DNS a local MinIO does not
 * have. Driven from config so moving to real S3 is a config change, not a
 * code change. Uploads stream via `Upload` from @aws-sdk/lib-storage rather
 * than buffering large media in Node's heap — including raw/*.json, since
 * some provider responses embed base64.
 */
@Injectable()
export class S3StorageAdapter implements StorageAdapter {
  private readonly logger = new Logger(S3StorageAdapter.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly browserPathPrefix: string | undefined;

  constructor(config: EngineConfig) {
    this.bucket = config.s3.bucket;
    this.client = createS3Client(config);
    this.browserPathPrefix = config.s3BrowserPathPrefix;
  }

  async put(key: string, body: Buffer | Readable, meta: { mime: string }): Promise<PutResult> {
    const startedAt = Date.now();
    return this.logged('put', { storageKey: key, contentType: meta.mime }, async () => {
      const upload = new Upload({
        client: this.client,
        params: { Bucket: this.bucket, Key: key, Body: body, ContentType: meta.mime },
      });
      const result = await upload.done();
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      const bytes = head.ContentLength ?? 0;
      this.logger.debug(
        { storageKey: key, bytes, contentType: meta.mime, durationMs: Date.now() - startedAt },
        'storage object put',
      );
      return { key, etag: result.ETag ?? '', bytes };
    });
  }

  async getStream(key: string, range?: ByteRange): Promise<Readable> {
    const rangeHeader = range ? `bytes=${range.start}-${range.end ?? ''}` : undefined;
    const res = await this.logged('get', { storageKey: key, range: rangeHeader }, () =>
      this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: rangeHeader })),
    );
    return res.Body as Readable;
  }

  async stat(key: string): Promise<{ bytes: number; etag: string; mime: string }> {
    const head = await this.logged('stat', { storageKey: key }, () =>
      this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })),
    );
    return {
      bytes: head.ContentLength ?? 0,
      etag: head.ETag ?? '',
      mime: head.ContentType ?? 'application/octet-stream',
    };
  }

  async copy(srcKey: string, destKey: string): Promise<PutResult> {
    const res = await this.logged('copy', { storageKey: destKey, sourceKey: srcKey }, () =>
      this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          Key: destKey,
          CopySource: `${this.bucket}/${srcKey}`,
        }),
      ),
    );
    const head = await this.stat(destKey);
    return { key: destKey, etag: res.CopyObjectResult?.ETag ?? '', bytes: head.bytes };
  }

  async delete(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const res = await this.logged('delete', { keys: keys.length }, () =>
      this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        }),
      ),
    );
    if (res.Errors?.length) {
      this.logger.warn(
        {
          keys: keys.length,
          failed: res.Errors.map((entry) => ({ storageKey: entry.Key, code: entry.Code })),
        },
        'storage delete partially failed',
      );
    } else {
      this.logger.debug({ keys: keys.length }, 'storage objects deleted');
    }
  }

  async list(prefix: string): Promise<{ keys: string[]; prefixes: string[] }> {
    const keys: string[] = [];
    const prefixes: string[] = [];
    let token: string | undefined;
    do {
      const res = await this.logged('list', { prefix }, () =>
        this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix,
            Delimiter: '/',
            ContinuationToken: token,
          }),
        ),
      );
      for (const entry of res.Contents ?? []) if (entry.Key) keys.push(entry.Key);
      for (const entry of res.CommonPrefixes ?? []) if (entry.Prefix) prefixes.push(entry.Prefix);
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return { keys, prefixes };
  }

  async listAll(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const res = await this.logged('listAll', { prefix }, () =>
        this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix,
            ContinuationToken: token,
          }),
        ),
      );
      for (const entry of res.Contents ?? []) if (entry.Key) keys.push(entry.Key);
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }

  async presignGet(key: string, ttlSec: number, options: PresignOptions = {}): Promise<string> {
    const url = await this.logged('presign get', { storageKey: key, ttlSec }, () =>
      getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
        expiresIn: ttlSec,
      }),
    );
    return options.external ? url : this.forBrowser(url);
  }

  async presignPut(key: string, ttlSec: number): Promise<string> {
    const url = await this.logged('presign put', { storageKey: key, ttlSec }, () =>
      getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: key }), {
        expiresIn: ttlSec,
      }),
    );
    return this.forBrowser(url);
  }

  /** Swaps the private S3 origin for the app-relative proxy prefix. The
   * signature stays valid because the proxy forwards the original path to
   * S3_ENDPOINT with that endpoint's Host header (see `mountStorageProxy`). */
  private forBrowser(signedUrl: string): string {
    if (!this.browserPathPrefix) return signedUrl;
    const url = new URL(signedUrl);
    return `${this.browserPathPrefix}${url.pathname}${url.search}`;
  }

  private async logged<T>(
    op: string,
    fields: Record<string, unknown>,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.logger.error({ op, bucket: this.bucket, ...fields, err }, 'storage operation failed');
      throw err;
    }
  }
}
