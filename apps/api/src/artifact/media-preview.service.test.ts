import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { MediaPreviewService } from './media-preview.service';

const blobRow = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  objectKey: 'k',
  mime: 'image/png',
  bytes: 100,
  deletedAt: null,
  ...over,
});

function service(rows: unknown[], scale: () => Promise<Buffer>, body = Buffer.from('PNGDATA')) {
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }),
  };
  const storage = { getStream: vi.fn(async () => Readable.from([body])) };
  class Testable extends MediaPreviewService {
    protected override scale() {
      return scale();
    }
  }
  return new Testable(db as never, storage as never, {} as never);
}

describe('MediaPreviewService.imageFromBlob', () => {
  it('sends the scaled picture as a JPEG', async () => {
    const s = service([blobRow()], async () => Buffer.from('JPEG'));
    expect(await s.imageFromBlob('b1', 'item 0')).toEqual({
      mime: 'image/jpeg',
      base64: Buffer.from('JPEG').toString('base64'),
      label: 'item 0',
    });
  });

  it('falls back to a small original when ffmpeg fails, and skips a big one', async () => {
    const fail = async () => {
      throw new Error('ffmpeg: not found');
    };
    const small = await service([blobRow()], fail).imageFromBlob('b1', 'x');
    expect(small).toMatchObject({
      mime: 'image/png',
      base64: Buffer.from('PNGDATA').toString('base64'),
    });
    const big = service([blobRow()], fail, Buffer.alloc(2_000_000));
    expect(await big.imageFromBlob('b1', 'x')).toBeNull();
    const webp = service([blobRow({ mime: 'image/webp' })], fail);
    expect(await webp.imageFromBlob('b1', 'x')).toBeNull();
  });

  it('skips missing, deleted, oversized and non-image blobs', async () => {
    const ok = async () => Buffer.from('JPEG');
    expect(await service([], ok).imageFromBlob('b1', 'x')).toBeNull();
    expect(await service([blobRow({ deletedAt: 'then' })], ok).imageFromBlob('b1', 'x')).toBeNull();
    expect(await service([blobRow({ bytes: 30_000_000 })], ok).imageFromBlob('b1', 'x')).toBeNull();
    expect(await service([blobRow({ mime: 'video/mp4' })], ok).imageFromBlob('b1', 'x')).toBeNull();
  });
});
