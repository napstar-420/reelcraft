import { describe, expect, it, vi } from 'vitest';
import { DeepgramAdapter } from '../deepgram/deepgram.adapter';
import { previewSpeech } from './preview-speech';

function adapter(fetchBody: string) {
  const stub = {} as never;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from(fetchBody),
      text: async () => fetchBody,
    }),
  );
  return new DeepgramAdapter({ get: async () => 'key' }, stub, stub, stub, stub);
}

describe('previewSpeech', () => {
  it('speaks the sample with the settings and says what it cost', async () => {
    const result = await previewSpeech(adapter('AUDIO'), {
      modelId: 'aura-2',
      params: { voiceId: 'thalia-en', outputFormat: 'mp3_48k' },
      text: 'A short sample.',
    });
    expect(Buffer.from(result.audioBase64, 'base64').toString()).toBe('AUDIO');
    expect(result).toMatchObject({ mime: 'audio/mpeg', characters: 15 });
    expect(result.costUsd).toBeCloseTo(15 * 0.00003);
  });

  it('refuses settings the model does not take, before anything is spoken', async () => {
    await expect(
      previewSpeech(adapter('x'), {
        modelId: 'aura-2',
        params: { speed: 3 },
        text: 'Hi',
      }),
    ).rejects.toThrow(/Speed/);
  });

  it('refuses a model that cannot speak', async () => {
    await expect(
      previewSpeech(adapter('x'), { modelId: 'nova-3', params: {}, text: 'Hi' }),
    ).rejects.toThrow(/not a speech model/);
  });
});
