import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderRequest } from '../provider-adapter.interface';
import { DeepgramAdapter } from './deepgram.adapter';

function adapter(): DeepgramAdapter {
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ objectKey: 'k/a.wav', mime: 'audio/wav' }]),
        }),
      }),
    }),
  };
  return new DeepgramAdapter(
    { get: () => Promise.resolve('dg-key') } as never,
    { getStream: () => Promise.resolve(Readable.from([Buffer.from('wav-bytes')])) } as never,
    db as never,
    {} as never,
  );
}

const request: ProviderRequest = {
  modality: 'media',
  modelId: 'nova-3',
  params: { slots: { source: { blobId: 'blob-1' } } },
  renderedPrompt: '',
};

afterEach(() => vi.unstubAllGlobals());

describe('DeepgramAdapter transcription', () => {
  it('uploads the audio bytes instead of a URL, so no public address is needed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        metadata: { duration: 1.5 },
        results: {
          channels: [
            {
              alternatives: [
                {
                  transcript: 'hello world',
                  words: [
                    { word: 'hello', start: 0, end: 0.5 },
                    { word: 'world', start: 0.6, end: 1.2 },
                  ],
                },
              ],
            },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const deepgram = adapter();

    const handle = await deepgram.submit(request, 'key-1');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await deepgram.poll(handle)).toEqual({ done: true, outcome: 'succeeded' });
    const result = await deepgram.fetch(handle);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).not.toContain('callback');
    expect(init.headers['Content-Type']).toBe('audio/wav');
    expect(Buffer.from(init.body).toString()).toBe('wav-bytes');
    expect(result.output).toMatchObject({
      transcript: 'hello world',
      durationSec: 1.5,
      words: [
        { text: 'hello', startSec: 0, endSec: 0.5 },
        { text: 'world', startSec: 0.6, endSec: 1.2 },
      ],
    });
  });

  it('keeps the punctuation of each word and splits the transcript into sentences', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          metadata: { duration: 3 },
          results: {
            channels: [
              {
                alternatives: [
                  {
                    transcript: 'Milo cooked. Then he ate!',
                    words: [
                      { word: 'milo', punctuated_word: 'Milo', start: 0, end: 0.4 },
                      { word: 'cooked', punctuated_word: 'cooked.', start: 0.4, end: 1 },
                      { word: 'then', punctuated_word: 'Then', start: 1.4, end: 1.8 },
                      { word: 'he', punctuated_word: 'he', start: 1.8, end: 2 },
                      { word: 'ate', punctuated_word: 'ate!', start: 2, end: 2.6 },
                    ],
                  },
                ],
              },
            ],
          },
        }),
      ),
    );
    const deepgram = adapter();
    const result = await deepgram.fetch(await deepgram.submit(request, 'key-1'));
    expect(result.output).toMatchObject({
      sentences: [
        { text: 'Milo cooked.', startSec: 0, endSec: 1 },
        { text: 'Then he ate!', startSec: 1.4, endSec: 2.6 },
      ],
    });
    expect((result.output as { words: Array<{ text: string }> }).words[1]!.text).toBe('cooked.');
  });

  it("puts Deepgram's reason in the error when the request is rejected", async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ err_code: 'BAD_REQUEST', err_msg: 'Bad audio' }, { status: 400 }),
        ),
    );
    const deepgram = adapter();
    const handle = await deepgram.submit(request, 'key-1');
    await expect(deepgram.fetch(handle)).rejects.toThrow('Deepgram transcription: 400 Bad audio');
  });
});
