import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpeechSetting } from '@reelcraft/shared';
import { ElevenLabsAdapter } from './elevenlabs.adapter';
import {
  ELEVENLABS_MODELS,
  elevenLabsOptions,
  elevenLabsRequest,
  specFromLive,
  toVoiceInfo,
} from './elevenlabs-speech';

const keys = (key: string | undefined = 'xi-key') => ({ get: vi.fn().mockResolvedValue(key) });

function audio(body: string, type = 'audio/mpeg') {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': type }),
    arrayBuffer: async () => Buffer.from(body),
    text: async () => body,
  } as unknown as Response;
}
function failure(status: number, body: unknown) {
  return {
    ok: false,
    status,
    statusText: 'Error',
    headers: new Headers(),
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}
function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

const settingKeys = (modelId: string) =>
  elevenLabsOptions(ELEVENLABS_MODELS[modelId]!).settings.map((s: SpeechSetting) => s.key);

/** A fetch that answers the model list with nothing, so the known models apply, and gives
 * each speech request the next response in turn. */
function speechFetch(...responses: Response[]) {
  const queue = [...responses];
  return vi.fn(async (url: string | URL | Request, _init?: RequestInit) =>
    String(url).endsWith('/v1/models') ? json([]) : queue.shift()!,
  );
}
const speechCalls = (fetch: ReturnType<typeof speechFetch>) =>
  fetch.mock.calls.filter(([url]) => !String(url).endsWith('/v1/models'));

afterEach(() => vi.unstubAllGlobals());

describe('ElevenLabs model settings', () => {
  it('offers only the voice settings each model supports', () => {
    expect(settingKeys('eleven_v4')).toContain('stability');
    expect(settingKeys('eleven_v4')).toContain('similarityBoost');
    expect(settingKeys('eleven_v4')).not.toContain('style');
    expect(settingKeys('eleven_v4')).not.toContain('speed');
    expect(settingKeys('eleven_multilingual_v2')).toEqual(
      expect.arrayContaining(['stability', 'similarityBoost', 'style', 'speed', 'speakerBoost']),
    );
    expect(settingKeys('eleven_multilingual_v2')).not.toContain('languageCode');
    expect(settingKeys('eleven_flash_v2_5')).toContain('languageCode');
    expect(settingKeys('eleven_flash_v2_5')).not.toContain('style');
  });

  it('gives Eleven v3 the Creative, Natural and Robust stability presets', () => {
    const stability = elevenLabsOptions(ELEVENLABS_MODELS.eleven_v3!).settings.find(
      (s) => s.key === 'stability',
    );
    expect(stability).toMatchObject({ kind: 'choice', default: 0.5 });
    expect(stability?.kind === 'choice' && stability.options.map((o) => o.label)).toEqual([
      'Creative',
      'Natural',
      'Robust',
    ]);
  });

  it('halves the price of the cheaper models', () => {
    const price = (id: string) => elevenLabsOptions(ELEVENLABS_MODELS[id]!).pricePerKCharsUsd;
    expect(price('eleven_flash_v2_5')).toBe(price('eleven_v4') / 2);
  });

  it('builds a spec for a model it does not know from the live flags', () => {
    const spec = specFromLive({
      model_id: 'eleven_next',
      name: 'Eleven Next',
      can_do_text_to_speech: true,
      can_use_style: true,
      can_use_speaker_boost: false,
      maximum_text_length_per_request: 8000,
      model_rates: { character_cost_multiplier: 0.5 },
      languages: [{ language_id: 'en', name: 'English' }],
    });
    const keysOf = elevenLabsOptions(spec).settings.map((s) => s.key);
    expect(keysOf).toContain('style');
    expect(keysOf).not.toContain('speakerBoost');
    expect(keysOf).toContain('languageCode');
    expect(spec.maxChars).toBe(8000);
    expect(spec.badges).toEqual(['50% cheaper']);
  });

  it('keeps what is documented about a known model and takes the live limits', () => {
    const spec = specFromLive({
      model_id: 'eleven_v4',
      name: 'Eleven v4',
      can_use_style: true,
      maximum_text_length_per_request: 12_000,
    });
    expect(spec.style).toBe(false);
    expect(spec.maxChars).toBe(12_000);
  });
});

describe('elevenLabsRequest', () => {
  const base = {
    voiceId: 'v1',
    modelId: 'eleven_multilingual_v2',
    text: 'Hi',
    format: 'mp3_44100_128',
  };

  it('sends no voice settings when none are set, so the voice keeps its own', () => {
    const { url, body } = elevenLabsRequest({ ...base, params: {} });
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/v1?output_format=mp3_44100_128');
    expect(body).toEqual({ text: 'Hi', model_id: 'eleven_multilingual_v2' });
  });

  it('sends the whole voice settings block once one is set', () => {
    const { body } = elevenLabsRequest({ ...base, params: { speed: 1.1 } });
    expect(body.voice_settings).toEqual({
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0,
      speed: 1.1,
      use_speaker_boost: true,
    });
  });

  it('maps every setting to its ElevenLabs field', () => {
    const { url, body } = elevenLabsRequest({
      ...base,
      previousText: 'Before.',
      nextText: 'After.',
      params: {
        stability: 0.2,
        similarityBoost: 0.9,
        style: 0.4,
        speakerBoost: false,
        languageCode: 'fr',
        seed: 42,
        textNormalization: 'on',
        languageTextNormalization: true,
        usePvcAsIvc: true,
        enableLogging: false,
        pronunciationDictionaries: [{ id: 'd1', versionId: 'ver1' }, { id: 'd2' }],
      },
    });
    expect(url).toContain('enable_logging=false');
    expect(body).toMatchObject({
      language_code: 'fr',
      seed: 42,
      previous_text: 'Before.',
      next_text: 'After.',
      apply_text_normalization: 'on',
      apply_language_text_normalization: true,
      use_pvc_as_ivc: true,
      voice_settings: {
        stability: 0.2,
        similarity_boost: 0.9,
        style: 0.4,
        use_speaker_boost: false,
      },
      pronunciation_dictionary_locators: [
        { pronunciation_dictionary_id: 'd1', version_id: 'ver1' },
        { pronunciation_dictionary_id: 'd2' },
      ],
    });
  });

  it('maps a voice from the voice list', () => {
    expect(
      toVoiceInfo({
        voice_id: 'abc',
        name: 'Louise',
        category: 'premade',
        description: 'Calm',
        preview_url: 'https://x/p.mp3',
        labels: { gender: 'female', age: 'middle_aged', accent: 'american', use_case: 'narration' },
        verified_languages: [{ language: 'en' }, { language: 'fr' }],
      }),
    ).toEqual({
      id: 'abc',
      name: 'Louise',
      description: 'Calm',
      gender: 'female',
      age: 'middle_aged',
      accent: 'american',
      languages: ['en', 'fr'],
      useCases: ['narration'],
      category: 'premade',
      previewUrl: 'https://x/p.mp3',
    });
  });
});

describe('ElevenLabsAdapter', () => {
  const request = (
    text: string,
    params: Record<string, unknown> = {},
    modelId = 'eleven_multilingual_v2',
  ) => ({
    modality: 'audio' as const,
    modelId,
    params: { voiceId: 'v1', ...params, slots: { text } },
  });

  it('lists the known models when there is no key, and the live ones with a key', async () => {
    const offline = new ElevenLabsAdapter(keys(undefined) as never);
    const known = (await offline.listModels()).map((m) => m.modelId);
    expect(known.slice(0, 3)).toEqual(['eleven_v4', 'eleven_v4_turbo', 'eleven_v3']);

    const fetch = vi.fn().mockResolvedValue(
      json([
        { model_id: 'eleven_flash_v2_5', name: 'Flash', can_do_text_to_speech: true },
        { model_id: 'eleven_v4', name: 'v4', can_do_text_to_speech: true },
        { model_id: 'eleven_multilingual_sts_v2', name: 'STS', can_do_text_to_speech: false },
      ]),
    );
    vi.stubGlobal('fetch', fetch);
    const online = new ElevenLabsAdapter(keys() as never);
    expect((await online.listModels()).map((m) => m.modelId)).toEqual([
      'eleven_v4',
      'eleven_flash_v2_5',
    ]);
    await online.listModels();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to the known models when ElevenLabs cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const models = await new ElevenLabsAdapter(keys() as never).listModels();
    expect(models.length).toBe(Object.keys(ELEVENLABS_MODELS).length);
  });

  it('estimates by characters at the model price, or the stage price', async () => {
    const adapter = new ElevenLabsAdapter(keys(undefined) as never);
    const flash = await adapter.estimate(request('a'.repeat(1000), {}, 'eleven_flash_v2_5'));
    expect(flash.expectedUsd).toBeCloseTo(0.05);
    const own = await adapter.estimate(request('a'.repeat(1000), { pricePerCharacterUsd: 0.0002 }));
    expect(own.expectedUsd).toBeCloseTo(0.2);
  });

  it('speaks the text with the voice, format and settings chosen', async () => {
    const fetch = speechFetch(audio('MP3DATA'));
    vi.stubGlobal('fetch', fetch);
    const adapterWithKey = new ElevenLabsAdapter(keys() as never);
    const req = request('Hello world.', {
      voiceId: 'voice-9',
      outputFormat: 'mp3_44100_64',
      stability: 0.3,
      seed: 7,
    });
    const handle = await adapterWithKey.submit(req, 'job-1');
    const result = await adapterWithKey.fetch(handle);
    const [url, init] = speechCalls(fetch)[0]!;
    expect(url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/voice-9?output_format=mp3_44100_64',
    );
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      text: 'Hello world.',
      model_id: 'eleven_multilingual_v2',
      seed: 7,
      voice_settings: { stability: 0.3 },
    });
    expect(result.output).toMatchObject({
      kind: 'media.audio',
      mime: 'audio/mpeg',
      filename: 'speech.mp3',
      base64: Buffer.from('MP3DATA').toString('base64'),
    });
    expect(result.repro).toEqual({
      level: 'approximate',
      seed: '7',
      providerVersion: 'eleven_multilingual_v2',
    });
    expect(result.costUsd).toBeCloseTo(12 * 0.0001);
  });

  it('splits text longer than the model takes and stitches the pieces together', async () => {
    const fetch = speechFetch(audio('A'), audio('B'));
    vi.stubGlobal('fetch', fetch);
    const adapter = new ElevenLabsAdapter(keys() as never);
    // Multilingual v2 takes 10,000 characters per request.
    const sentence = `${'word '.repeat(900).trim()}. `;
    const text = (sentence + sentence + sentence).trim();
    const handle = await adapter.submit(request(text), 'job-2');
    const result = await adapter.fetch(handle);
    expect(speechCalls(fetch)).toHaveLength(2);
    const first = JSON.parse((speechCalls(fetch)[0]![1] as RequestInit).body as string);
    const second = JSON.parse((speechCalls(fetch)[1]![1] as RequestInit).body as string);
    expect(first.next_text).toBe(second.text);
    expect(second.previous_text).toBe(first.text);
    expect(Buffer.from((result.output as { base64: string }).base64, 'base64').toString()).toBe(
      'AB',
    );
  });

  it('refuses a long text in a format that cannot be joined', async () => {
    vi.stubGlobal('fetch', speechFetch());
    const adapter = new ElevenLabsAdapter(keys() as never);
    const handle = await adapter.submit(
      request('word. '.repeat(3000), { outputFormat: 'opus_48000_64' }),
      'job-3',
    );
    await expect(adapter.fetch(handle)).rejects.toThrow(/can't be joined/);
  });

  it('asks for a voice instead of guessing one', async () => {
    vi.stubGlobal('fetch', speechFetch());
    const adapter = new ElevenLabsAdapter(keys() as never);
    const handle = await adapter.submit(
      { modality: 'audio', modelId: 'eleven_v4', params: { slots: { text: 'Hi' } } },
      'job-0',
    );
    await expect(adapter.fetch(handle)).rejects.toThrow(/no voice is chosen/);
  });

  it('reports why ElevenLabs refused a request', async () => {
    vi.stubGlobal(
      'fetch',
      speechFetch(
        failure(422, { detail: { status: 'invalid_voice', message: 'Voice not found' } }),
      ),
    );
    const adapter = new ElevenLabsAdapter(keys() as never);
    const handle = await adapter.submit(request('Hi'), 'job-4');
    await expect(adapter.fetch(handle)).rejects.toThrow('ElevenLabs: 422 Voice not found');
  });

  it('points to Settings when the key is rejected', async () => {
    vi.stubGlobal('fetch', speechFetch(failure(401, { detail: { message: 'Invalid API key' } })));
    const adapter = new ElevenLabsAdapter(keys() as never);
    const handle = await adapter.submit(request('Hi'), 'job-5');
    await expect(adapter.fetch(handle)).rejects.toThrow(/key was rejected.*Settings/);
  });

  it('lists voices a page at a time', async () => {
    const fetch = vi.fn().mockResolvedValue(
      json({
        voices: [{ voice_id: 'a', name: 'Ada', labels: { gender: 'female' } }],
        has_more: true,
        next_page_token: 'p2',
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const page = await new ElevenLabsAdapter(keys() as never).listVoices({
      search: 'ada',
      cursor: 'p1',
      limit: 20,
    });
    expect(String(fetch.mock.calls[0]![0])).toContain('search=ada');
    expect(String(fetch.mock.calls[0]![0])).toContain('next_page_token=p1');
    expect(page).toEqual({
      voices: [{ id: 'a', name: 'Ada', gender: 'female' }],
      nextCursor: 'p2',
    });
  });
});
