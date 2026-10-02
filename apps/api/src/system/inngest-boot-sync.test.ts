import { describe, expect, it, vi } from 'vitest';
import type { LoggerService } from '@nestjs/common';
import { syncInngestOnBoot } from './inngest-boot-sync';

const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as LoggerService;

describe('syncInngestOnBoot', () => {
  it('PUTs the serve endpoint and resolves once Inngest accepts', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(new Response('unreachable', { status: 500 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    await syncInngestOnBoot({
      url: 'http://127.0.0.1:8080/api/inngest',
      logger,
      fetchImpl,
      initialDelayMs: 0,
      maxDelayMs: 0,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl).toHaveBeenLastCalledWith('http://127.0.0.1:8080/api/inngest', {
      method: 'PUT',
    });
  });
});
