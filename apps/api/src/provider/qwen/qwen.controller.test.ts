import { BadGatewayException, ConflictException, HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { QwenServiceError } from './qwen.adapter';
import { QwenTtsController } from './qwen.controller';

const download = { state: 'downloading', downloadedBytes: 1, totalBytes: 2 };
const controller = (qwen: Record<string, unknown>) => new QwenTtsController(qwen as never);

describe('QwenTtsController', () => {
  it('relays each action for the model named in the body', async () => {
    const qwen = {
      download: vi.fn(async () => download),
      cancelDownload: vi.fn(async () => download),
      remove: vi.fn(async () => download),
      link: vi.fn(async () => download),
    };
    const c = controller(qwen);
    await c.download({ modelId: 'Qwen/a' });
    await c.cancel({ modelId: 'Qwen/a' });
    await c.remove({ modelId: 'Qwen/a' });
    await c.link({ modelId: 'Qwen/a', path: '/models/a' });
    expect(qwen.download).toHaveBeenCalledWith('Qwen/a');
    expect(qwen.cancelDownload).toHaveBeenCalledWith('Qwen/a');
    expect(qwen.remove).toHaveBeenCalledWith('Qwen/a');
    expect(qwen.link).toHaveBeenCalledWith('Qwen/a', '/models/a');
  });

  it("passes on the service's status and reason when it refuses", async () => {
    const c = controller({
      download: vi.fn().mockRejectedValue(new QwenServiceError(507, 'Not enough disk space')),
    });
    const error = await c.download({ modelId: 'Qwen/a' }).catch((e) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(507);
    expect(error.message).toBe('Not enough disk space');
  });

  it('keeps a refusal from the runtime as it is, such as "not set up yet"', async () => {
    const c = controller({
      download: vi.fn().mockRejectedValue(new ConflictException('Qwen3-TTS is not set up yet.')),
    });
    const error = await c.download({ modelId: 'Qwen/a' }).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getStatus()).toBe(409);
  });

  it('calls anything else a bad gateway: the service could not be reached', async () => {
    const c = controller({ link: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) });
    await expect(c.link({ modelId: 'Qwen/a', path: '/x' })).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
});
