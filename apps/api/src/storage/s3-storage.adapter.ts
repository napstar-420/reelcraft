import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ByteRange, PutResult } from '@reefcraft/shared';
import { EngineConfig } from '../config/engine-config';
import type { StorageAdapter } from './storage.adapter';
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
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: EngineConfig) {
    this.bucket = config.s3.bucket;
    this.client = createS3Client(config);
  }

  async put(key: string, body: Buffer | Readable, meta: { mime: string }): Promise<PutResult> {
    const upload = new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: key, Body: body, ContentType: meta.mime },
    });
    const result = await upload.done();
    const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    return { key, etag: result.ETag ?? '', bytes: head.ContentLength ?? 0 };
  }

  async getStream(key: string, range?: ByteRange): Promise<Readable> {
    const rangeHeader = range ? `bytes=${range.start}-${range.end ?? ''}` : undefined;
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: rangeHeader }),
    );
    return res.Body as Readable;
  }

  async stat(key: string): Promise<{ bytes: number; etag: string; mime: string }> {
    const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    return {
      bytes: head.ContentLength ?? 0,
      etag: head.ETag ?? '',
      mime: head.ContentType ?? 'application/octet-stream',
    };
  }

  async copy(srcKey: string, destKey: string): Promise<PutResult> {
    const res = await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: destKey,
        CopySource: `${this.bucket}/${srcKey}`,
      }),
    );
    const head = await this.stat(destKey);
    return { key: destKey, etag: res.CopyObjectResult?.ETag ?? '', bytes: head.bytes };
  }

  async delete(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.client.send(
      new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })) },
      }),
    );
  }

  async presignGet(key: string, ttlSec: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: ttlSec,
    });
  }

  async presignPut(key: string, ttlSec: number): Promise<string> {
    return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: ttlSec,
    });
  }
}
