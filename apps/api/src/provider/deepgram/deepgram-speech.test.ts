import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEEPGRAM_FAMILIES,
  applyPronunciations,
  deepgramConflict,
  deepgramFormat,
  deepgramOptions,
  deepgramRequest,
  filterVoices,
} from './deepgram-speech';
import { DeepgramSpeech } from './deepgram-speech.service';
import { AURA_1_VOICES, AURA_2_VOICES, FLUX_VOICES } from './deepgram-voices';

const keys = (key: string | undefined = 'dg-key') => ({ get: vi.fn().mockResolvedValue(key) });

function audio(body: string) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    arrayBuffer: async () => Buffer.from(body),
    text: async () => body,
  } as unknown as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('Deepgram voices', () => {
  it('has the documented catalogs', () => {
    expect(FLUX_VOICES.length).toBe(36);
    expect(AURA_2_VOICES.length).toBe(90);
    expect(AURA_1_VOICES.length).toBe(12);
    expect(new Set(AURA_2_VOICES.map((v) => v.id)).size).toBe(AURA_2_VOICES.length);
  });

  it('stores the voice part of the model string, with its language', () => {
    expect(AURA_2_VOICES.find((v) => v.id === 'thalia-en')).toMatchObject({
      name: 'Thalia',
      gender: 'female',
      accent: 'American',
      languages: ['en'],
    });
    expect(AURA_2_VOICES.find((v) => v.id === 'agathe-fr')?.languages).toEqual(['fr']);
  });

  it('every default voice is in its family', () => {
    for (const spec of Object.values(DEEPGRAM_FAMILIES)) {
      expect(spec.voices.some((v) => v.id === spec.defaultVoice.id)).toBe(true);
    }
  });

  it('narrows by language, gender and search', () => {
    const spanish = filterVoices(AURA_2_VOICES, { language: 'es' });
    expect(spanish.length).toBe(17);
    const men = filterVoices(AURA_2_VOICES, { language: 'en', gender: 'male' });
    expect(men.every((v) => v.gender === 'male')).toBe(true);
    expect(
      filterVoices(AURA_2_VOICES, { search: 'peninsular' }).every((v) => v.accent === 'Peninsular'),
    ).toBe(true);
  });
});

describe('Deepgram output formats', () => {
  it('maps a format id to the query Deepgram expects', () => {
    expect(deepgramFormat('wav_24000')).toEqual({
      query: { encoding: 'linear16', container: 'wav', sample_rate: '24000' },
      family: 'wav',
    });
    expect(deepgramFormat('mp3_48k').query).toEqual({ encoding: 'mp3', bit_rate: '48000' });
    expect(deepgramFormat('opus_12k').query).toEqual({
      encoding: 'opus',
      container: 'ogg',
      bit_rate: '12000',
    });
    expect(deepgramFormat('flac_16000').query).toEqual({ encoding: 'flac', sample_rate: '16000' });
    expect(deepgramFormat('aac_96k').query).toEqual({ encoding: 'aac', bit_rate: '96000' });
  });

  it('every format a family offers can be requested', () => {
    for (const spec of Object.values(DEEPGRAM_FAMILIES)) {
      expect(spec.formats.some((f) => f.value === spec.defaultFormat)).toBe(true);
      for (const format of spec.formats) expect(() => deepgramFormat(format.value)).not.toThrow();
    }
  });
});

describe('deepgramRequest', () => {
  it('builds the Aura-2 request on /v1/speak', () => {
    const { url, body } = deepgramRequest({
      family: 'aura-2',
      voiceId: 'thalia-en',
      text: 'Hello',
      format: 'mp3_48k',
      params: { speed: 0.9, mipOptOut: true, tag: 'reelcraft' },
    });
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe('https://api.deepgram.com/v1/speak');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      model: 'aura-2-thalia-en',
      encoding: 'mp3',
      bit_rate: '48000',
      speed: '0.9',
      mip_opt_out: 'true',
      tag: 'reelcraft',
    });
    expect(body).toEqual({ text: 'Hello' });
  });

  it('builds the Flux request on /v2/speak with expressivity', () => {
    const { url } = deepgramRequest({
      family: 'flux',
      voiceId: 'haley-en',
      text: 'Hi',
      format: 'wav_24000',
      params: { expressivity: -1 },
    });
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/v2/speak');
    expect(parsed.searchParams.get('model')).toBe('flux-haley-en');
    expect(parsed.searchParams.get('expressivity')).toBe('-1');
    expect(parsed.searchParams.has('speed')).toBe(false);
  });

  it('leaves out settings Deepgram treats as the default', () => {
    const { url } = deepgramRequest({
      family: 'aura',
      voiceId: 'asteria-en',
      text: 'Hi',
      format: 'mp3_48k',
      params: { speed: 1, expressivity: 2 },
    });
    expect(new URL(url).searchParams.has('speed')).toBe(false);
    expect(new URL(url).searchParams.has('expressivity')).toBe(false);
  });
});

describe('pronunciations', () => {
  it('wraps each whole word in the escaped inline marker', () => {
    const text = applyPronunciations('Take dupilumab daily. Not dupilumabs.', [
      { word: 'dupilumab', ipa: 'duːˈpɪljuːmæb' },
    ]);
    expect(text).toBe(
      'Take \\{"word":"dupilumab","pronounce":"duːˈpɪljuːmæb"\\} daily. Not dupilumabs.',
    );
  });

  it('matches regardless of case and keeps the text as written in the marker', () => {
    expect(applyPronunciations('SQL is fun', [{ word: 'sql', ipa: 'ˈsiːkwəl' }])).toBe(
      '\\{"word":"SQL","pronounce":"ˈsiːkwəl"\\} is fun',
    );
  });

  it('does not treat a word as a pattern', () => {
    expect(applyPronunciations('C++ rocks', [{ word: 'C++', ipa: 'ˈsiː plʌs plʌs' }])).toContain(
      'pronounce',
    );
  });

  it('refuses pronunciations with a speed on Flux, but not on Aura-2', () => {
    const params = { speed: 0.9, pronunciations: [{ word: 'a', ipa: 'b' }] };
    expect(deepgramConflict('flux', params)).toMatch(/pronunciations/);
    expect(deepgramConflict('aura-2', params)).toBeUndefined();
    expect(deepgramConflict('flux', { ...params, speed: 1 })).toBeUndefined();
  });
});

describe('DeepgramSpeech', () => {
  const request = (text: string, params: Record<string, unknown> = {}, modelId = 'aura-2') => ({
    modality: 'audio' as const,
    modelId,
    params: { ...params, slots: { text } },
  });

  it('lists the three speech families as audio models with their settings', () => {
    const models = new DeepgramSpeech(keys() as never).models();
    expect(models.map((m) => m.modelId)).toEqual(['flux', 'aura-2', 'aura']);
    expect(models.every((m) => m.modalities?.includes('audio'))).toBe(true);
    expect(deepgramOptions('aura').settings.map((s) => s.key)).toEqual(['mipOptOut', 'tag']);
    expect(deepgramOptions('flux').settings.map((s) => s.key)).toContain('expressivity');
    expect(deepgramOptions('aura-2').settings.map((s) => s.key)).not.toContain('expressivity');
  });

  it('estimates by characters at the family price', () => {
    const speech = new DeepgramSpeech(keys() as never);
    expect(speech.estimate(request('a'.repeat(1000), {}, 'aura-2')).expectedUsd).toBeCloseTo(0.03);
    expect(speech.estimate(request('a'.repeat(1000), {}, 'aura')).expectedUsd).toBeCloseTo(0.015);
    expect(speech.estimate(request('a'.repeat(1000), {}, 'flux')).expectedUsd).toBeCloseTo(0.045);
  });

  it('speaks the text and bills its characters', async () => {
    const fetch = vi.fn().mockResolvedValue(audio('WAVDATA'));
    vi.stubGlobal('fetch', fetch);
    const speech = new DeepgramSpeech(keys() as never);
    const handle = speech.submit(
      request('Hello there.', { voiceId: 'luna-en', outputFormat: 'mp3_32k' }),
      'job-1',
    );
    const result = await speech.fetch(handle);
    const [url, init] = fetch.mock.calls[0]!;
    expect(new URL(String(url)).searchParams.get('model')).toBe('aura-2-luna-en');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Token dg-key' });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ text: 'Hello there.' });
    expect(result.output).toMatchObject({ mime: 'audio/mpeg', filename: 'speech.mp3' });
    expect(result.costUsd).toBeCloseTo(12 * 0.00003);
  });

  it('sends pronunciations inline', async () => {
    const fetch = vi.fn().mockResolvedValue(audio('X'));
    vi.stubGlobal('fetch', fetch);
    const speech = new DeepgramSpeech(keys() as never);
    const handle = speech.submit(
      request('Say SQL.', { pronunciations: [{ word: 'SQL', ipa: 'ˈsiːkwəl' }] }),
      'job-2',
    );
    await speech.fetch(handle);
    expect(JSON.parse((fetch.mock.calls[0]![1] as RequestInit).body as string).text).toContain(
      '\\{"word":"SQL"',
    );
  });

  it('splits text over 2,000 characters and joins the WAV audio', async () => {
    const wavPart = (n: number) => {
      const header = Buffer.alloc(44);
      header.write('RIFF', 0, 'ascii');
      header.write('WAVE', 8, 'ascii');
      header.write('fmt ', 12, 'ascii');
      header.writeUInt32LE(16, 16);
      header.write('data', 36, 'ascii');
      header.writeUInt32LE(n, 40);
      return Buffer.concat([header, Buffer.alloc(n, 1)]);
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ...audio(''), arrayBuffer: async () => wavPart(4) })
      .mockResolvedValueOnce({ ...audio(''), arrayBuffer: async () => wavPart(6) });
    vi.stubGlobal('fetch', fetch);
    const speech = new DeepgramSpeech(keys() as never);
    const handle = speech.submit(request(`${'word '.repeat(300).trim()}. `.repeat(2)), 'job-3');
    const result = await speech.fetch(handle);
    expect(fetch).toHaveBeenCalledTimes(2);
    const joined = Buffer.from((result.output as { base64: string }).base64, 'base64');
    expect(joined.readUInt32LE(40)).toBe(10);
  });

  it('refuses a long text in a format that cannot be joined', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const speech = new DeepgramSpeech(keys() as never);
    const handle = speech.submit(
      request('word. '.repeat(600), { outputFormat: 'flac_16000' }),
      'j',
    );
    await expect(speech.fetch(handle)).rejects.toThrow(/can't be joined/);
  });

  it('refuses incompatible settings before anything is billed', () => {
    const speech = new DeepgramSpeech(keys() as never);
    expect(() =>
      speech.submit(
        request('Hi', { speed: 0.8, pronunciations: [{ word: 'Hi', ipa: 'haɪ' }] }, 'flux'),
        'j',
      ),
    ).toThrow(/pronunciations/);
  });

  it('reports why Deepgram refused a request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({ err_code: 'SPEED_NOT_SUPPORTED', err_msg: 'Speed is not supported' }),
      }),
    );
    const speech = new DeepgramSpeech(keys() as never);
    const handle = speech.submit(request('Hi'), 'j');
    await expect(speech.fetch(handle)).rejects.toThrow('Deepgram: 400 Speed is not supported');
  });
});
