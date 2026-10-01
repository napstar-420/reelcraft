import { HeadBucketCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineConfig } from '../config/engine-config';
import { BucketBootstrapService } from './bucket-bootstrap.service';

const send = vi.fn();
vi.mock('./s3-client.factory', () => ({ createS3Client: () => ({ send }) }));

function config(s3BrowserPathPrefix?: string): EngineConfig {
  return { s3: { bucket: 'video-engine' }, s3BrowserPathPrefix } as EngineConfig;
}

describe('BucketBootstrapService', () => {
  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({});
  });

  it('applies the browser CORS rule when media is served cross-origin', async () => {
    await new BucketBootstrapService(config()).onApplicationBootstrap();

    expect(send.mock.calls.map(([command]) => command.constructor)).toEqual([
      HeadBucketCommand,
      PutBucketCorsCommand,
    ]);
  });

  it('skips CORS behind the same-origin storage proxy', async () => {
    await new BucketBootstrapService(config('/storage')).onApplicationBootstrap();

    expect(send.mock.calls.map(([command]) => command.constructor)).toEqual([HeadBucketCommand]);
  });
});
