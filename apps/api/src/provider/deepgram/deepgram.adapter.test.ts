import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderRequest } from '../provider-adapter.interface';
import { DeepgramAdapter } from './deepgram.adapter';

function adapter(): DeepgramAdapter {
  const db = {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([{ objectKey: 'k/a.wav' }]) }) }),
    }),
  };
  return new DeepgramAdapter(
    { get: () => Promise.resolve('dg-key') } as never,
    { presignGet: () => Promise.resolve('http://media.test/a.wav') } as never,
    db as never,
    { publicApiBaseUrl: 'http://localhost:3000' } as never,
    {
      createOrGet: () => Promise.resolve({ id: 'job-1', callbackToken: 'tok' }),
    } as never,
  );
}

const request: ProviderRequest = {
  modality: 'media',
  modelId: 'nova-3',
  params: { slots: { source: { blobId: 'blob-1' } } },
  renderedPrompt: '',
};

afterEach(() => vi.unstubAllGlobals());

describe('DeepgramAdapter.submit', () => {
  it("puts Deepgram's reason in the error when the request is rejected", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ err_code: 'INVALID_CALLBACK', err_msg: 'Invalid callback URL' }),
          {
            status: 400,
            statusText: 'Bad Request',
          },
        ),
      ),
    );
    await expect(adapter().submit(request, 'key-1')).rejects.toThrow(
      'Deepgram submit: 400 Invalid callback URL',
    );
  });
});
