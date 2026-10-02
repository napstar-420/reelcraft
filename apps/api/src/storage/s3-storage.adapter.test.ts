import { describe, expect, it } from 'vitest';
import type { EngineConfig } from '../config/engine-config';
import { S3StorageAdapter } from './s3-storage.adapter';

function adapter(s3BrowserPathPrefix?: string): S3StorageAdapter {
  const config = {
    s3: {
      endpoint: 'http://127.0.0.1:9000',
      region: 'us-east-1',
      bucket: 'video-engine',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
      forcePathStyle: true,
    },
    s3BrowserPathPrefix,
  } as EngineConfig;
  return new S3StorageAdapter(config);
}

describe('S3StorageAdapter presigned URLs', () => {
  it('returns absolute S3 URLs when no browser prefix is configured', async () => {
    const url = await adapter().presignGet('runs/r1/out.mp4', 60);

    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:9000\/video-engine\/runs\/r1\/out\.mp4\?/);
  });

  it('rewrites browser-facing GET and PUT URLs onto the proxy prefix', async () => {
    const storage = adapter('/storage');

    const get = await storage.presignGet('runs/r1/out.mp4', 60);
    const put = await storage.presignPut('uploads/a b.png', 60);

    expect(get).toMatch(/^\/storage\/video-engine\/runs\/r1\/out\.mp4\?.*X-Amz-Signature=/);
    expect(put).toMatch(/^\/storage\/video-engine\/uploads\/a%20b\.png\?.*X-Amz-Signature=/);
  });

  it('keeps the signed path and query intact when rewriting', async () => {
    const absolute = new URL(await adapter().presignGet('k.png', 60));
    const relative = await adapter('/storage').presignGet('k.png', 60);
    const params = new URLSearchParams(relative.split('?')[1]);

    expect(relative.split('?')[0]).toBe(`/storage${absolute.pathname}`);
    expect(params.get('X-Amz-SignedHeaders')).toBe('host');
  });

  it('keeps URLs absolute for external fetchers', async () => {
    const url = await adapter('/storage').presignGet('k.png', 60, { external: true });

    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:9000\/video-engine\/k\.png\?/);
  });
});
