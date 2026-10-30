import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VoiceStudioStatusDto } from '@reelcraft/shared';
import { VoiceStudioAdapter } from './voicestudio.adapter';
import {
  VoiceStudioClient,
  VoiceStudioError,
  voiceStudioBaseUrl,
  voiceStudioErrorReason,
} from './voicestudio-client';
import {
  engineVoices,
  timingFromTranscription,
  usableEngines,
  voiceStudioOptions,
  voiceStudioRequestBody,
  type VoiceStudioEngine,
} from './voicestudio-speech';

const OMNI: VoiceStudioEngine = {
  id: 'omnivoice',
  display_name: 'VoiceStudio (OmniVoice)',
  available: true,
  supports_cloning: true,
  instruct_vocabulary: 'tags',
  preset_voices: [],
  default_voice: null,
};
const KITTEN: VoiceStudioEngine = {
  id: 'kittentts',
  display_name: 'KittenTTS',
  available: true,
  supports_cloning: false,
  instruct_vocabulary: 'freeform',
  preset_voices: ['expr-voice-2-f', 'expr-voice-3-m'],
  default_voice: 'expr-voice-2-f',
};

const UP: VoiceStudioStatusDto = {
  url: 'http://vs:3900',
  reachable: true,
  starting: false,
  version: '1.0.0',
  device: 'cpu',
  error: null,
};
const DOWN: VoiceStudioStatusDto = {
  ...UP,
  reachable: false,
  version: null,
  device: null,
  error: "VoiceStudio isn't reachable at http://vs:3900. Start VoiceStudio.",
};

const response = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    arrayBuffer: async () => new Uint8Array(Buffer.from(String(body))).buffer,
  }) as unknown as Response;

/** A client whose requests answer from `routes`, keyed by path. */
function fakeClient(routes: Record<string, unknown>, status: VoiceStudioStatusDto = UP) {
  const calls: Array<{ path: string; json?: unknown; body?: unknown }> = [];
  const answer = (path: string) => {
    if (!(path in routes)) throw new Error(`VoiceStudio isn't reachable at http://vs:3900.`);
    const value = routes[path];
    if (value instanceof Error) throw value;
    return value;
  };
  return {
    calls,
    client: {
      baseUrl: async () => 'http://vs:3900',
      status: vi.fn(async () => status),
      json: vi.fn(async (path: string) => answer(path)),
      request: vi.fn(async (path: string, init: { json?: unknown; body?: unknown }) => {
        calls.push({ path, json: init.json, body: init.body });
        return response(answer(path));
      }),
    },
  };
}

const adapter = (client: ReturnType<typeof fakeClient>['client']) =>
  new VoiceStudioAdapter(client as never, { getStream: vi.fn() } as never, {} as never);

const speechReq = (params: Record<string, unknown> = {}, text = 'Hello there.') => ({
  modality: 'audio' as const,
  modelId: 'omnivoice',
  params: { ...params, slots: { text } },
});

afterEach(() => vi.unstubAllGlobals());

describe('VoiceStudio helpers', () => {
  it('accepts an address with a trailing slash or /v1', () => {
    expect(voiceStudioBaseUrl('http://vs:3900/')).toBe('http://vs:3900');
    expect(voiceStudioBaseUrl(' http://vs:3900/v1/ ')).toBe('http://vs:3900');
  });

  it('reads the reason from OpenAI-style and FastAPI errors', () => {
    expect(voiceStudioErrorReason('{"error":{"message":"bad voice"},"detail":"x"}')).toBe(
      'bad voice',
    );
    expect(voiceStudioErrorReason('{"detail":"nope"}')).toBe('nope');
    expect(voiceStudioErrorReason('{"detail":{"message":"licence"}}')).toBe('licence');
    expect(voiceStudioErrorReason('boom')).toBe('boom');
  });

  it('uses only installed engines whose licence is accepted', () => {
    const engines = usableEngines([
      OMNI,
      { ...KITTEN, available: false },
      { id: 'gated', available: true, license_required: true, license_accepted: false },
      { id: 'accepted', available: true, license_required: true, license_accepted: true },
    ]);
    expect(engines.map((e) => e.id)).toEqual(['omnivoice', 'accepted']);
  });

  it('offers Delivery only to engines that read instructions as text', () => {
    const keys = (engine: VoiceStudioEngine) =>
      voiceStudioOptions(engine).settings.map((s) => s.key);
    expect(keys(OMNI)).toEqual(['language', 'speed', 'wordTimings', 'seed']);
    expect(keys(KITTEN)).toEqual(['language', 'speed', 'instructions', 'wordTimings', 'seed']);
  });

  it("defaults to the engine's own voice", () => {
    expect(voiceStudioOptions(OMNI).defaultVoice).toEqual({
      id: 'default',
      name: 'Engine default',
    });
    expect(voiceStudioOptions(KITTEN).defaultVoice?.id).toBe('expr-voice-2-f');
  });

  it('lists saved voices only for engines that can clone', () => {
    const profiles = [
      { voice_id: 'alloy', name: 'Alloy', type: 'openai_alias' },
      { voice_id: 'a1b2c3d4', name: 'Narrator', type: 'profile', language: 'en' },
    ];
    expect(engineVoices(OMNI, profiles)).toEqual([
      {
        id: 'a1b2c3d4',
        name: 'Narrator',
        category: 'cloned',
        description: 'Saved in VoiceStudio',
        languages: ['en'],
      },
    ]);
    expect(engineVoices(KITTEN, profiles).map((v) => v.id)).toEqual([
      'expr-voice-2-f',
      'expr-voice-3-m',
    ]);
  });

  it('sends only the settings that are set', () => {
    expect(
      voiceStudioRequestBody({
        engineId: 'omnivoice',
        voiceId: 'default',
        text: 'Hi',
        format: 'wav',
        params: { speed: 1, language: ' en ', instructions: '', seed: 7 },
      }),
    ).toEqual({
      model: 'omnivoice',
      input: 'Hi',
      voice: 'default',
      response_format: 'wav',
      seed: 7,
      language: 'en',
    });
  });

  it('turns a transcription into word timings with sentences', () => {
    const timing = timingFromTranscription({
      text: ' Hi there. Bye. ',
      language: 'en',
      duration: 2.5,
      words: [
        { word: ' Hi', start: 0, end: 0.3 },
        { word: 'there.', start: 0.3, end: 0.8 },
        { word: 'Bye.', start: 1.5, end: 2 },
      ],
    });
    expect(timing).toEqual({
      transcript: 'Hi there. Bye.',
      language: 'en',
      durationSec: 2.5,
      sentences: [
        { text: 'Hi there.', startSec: 0, endSec: 0.8 },
        { text: 'Bye.', startSec: 1.5, endSec: 2 },
      ],
      words: [
        { text: 'Hi', startSec: 0, endSec: 0.3 },
        { text: 'there.', startSec: 0.3, endSec: 0.8 },
        { text: 'Bye.', startSec: 1.5, endSec: 2 },
      ],
    });
  });
});

describe('VoiceStudioAdapter', () => {
  it('lists each installed engine as a speech model, and transcription', async () => {
    const { client } = fakeClient({ '/engines/tts': { backends: [OMNI, KITTEN] } });
    const models = await adapter(client).listModels();
    expect(models.map((m) => [m.modelId, m.modalities])).toEqual([
      ['omnivoice', ['audio']],
      ['kittentts', ['audio']],
      ['transcribe', ['media']],
    ]);
    expect(models[0]!.capabilities.speech?.pricePerKCharsUsd).toBe(0);
  });

  it('keeps the engines it last saw while VoiceStudio is closed', async () => {
    const routes: Record<string, unknown> = { '/engines/tts': { backends: [OMNI] } };
    const { client } = fakeClient(routes);
    const vs = adapter(client);
    expect((await vs.listModels())[0]!.unavailableModalities).toBeUndefined();
    delete routes['/engines/tts'];
    client.status.mockResolvedValue(DOWN);
    const models = await vs.listModels();
    expect(models.map((m) => m.modelId)).toEqual(['omnivoice', 'transcribe']);
    // Still a speech model, so the stage keeps it; the reason says why it can't speak now.
    expect(models[0]!.modalities).toEqual(['audio']);
    expect(models[0]!.unavailableModalities?.audio).toBe(DOWN.error);
  });

  it('says why there are no speech models when it has never reached VoiceStudio', async () => {
    const { client } = fakeClient({}, DOWN);
    const [only] = await adapter(client).listModels();
    expect(only!.modelId).toBe('transcribe');
    expect(only!.unavailableModalities?.audio).toBe(DOWN.error);
  });

  it('forgets the engines of a previous address', async () => {
    const routes: Record<string, unknown> = { '/engines/tts': { backends: [OMNI] } };
    const { client } = fakeClient(routes);
    const vs = adapter(client);
    await vs.listModels();
    delete routes['/engines/tts'];
    client.status.mockResolvedValue(DOWN);
    client.baseUrl = async () => 'http://other:3900';
    expect((await vs.listModels()).map((m) => m.modelId)).toEqual(['transcribe']);
  });

  it('only warns about an engine it could not check because the listing failed', async () => {
    const { client } = fakeClient({});
    expect(await adapter(client).checkModel('omnivoice')).toMatchObject({
      severity: 'warning',
      message: expect.stringMatching(/couldn't check "omnivoice"/),
    });
  });

  it('says why there is no engine to speak with when VoiceStudio is running', async () => {
    const reasonFor = async (backends: VoiceStudioEngine[]) =>
      (await adapter(fakeClient({ '/engines/tts': { backends } }).client).listModels())[0]!
        .unavailableModalities?.audio;
    expect(await reasonFor([])).toMatch(/no speech engine installed/);
    expect(await reasonFor([{ ...OMNI, license_required: true, license_accepted: false }])).toMatch(
      /need their licence accepted/,
    );
    expect(await reasonFor([{ ...OMNI, available: false }])).toMatch(/None of .* is ready/);
  });

  it('says why a pinned engine that is installed can not run', async () => {
    const vs = (backends: VoiceStudioEngine[]) =>
      adapter(fakeClient({ '/engines/tts': { backends } }).client);
    expect(
      await vs([{ ...OMNI, license_required: true, license_accepted: false }]).checkModel(
        'omnivoice',
      ),
    ).toMatchObject({ severity: 'error', message: expect.stringMatching(/licence accepted/) });
    expect(await vs([{ ...OMNI, available: false }]).checkModel('omnivoice')).toMatchObject({
      message: expect.stringMatching(/isn't ready in VoiceStudio/),
    });
  });

  it('warns when VoiceStudio is closed, and rejects an engine it does not have', async () => {
    expect(await adapter(fakeClient({}, DOWN).client).checkModel('omnivoice')).toMatchObject({
      severity: 'warning',
    });
    const { client } = fakeClient({ '/engines/tts': { backends: [OMNI] } });
    expect(await adapter(client).checkModel('omnivoice')).toBeUndefined();
    expect(await adapter(client).checkModel('indextts')).toMatchObject({ severity: 'error' });
  });

  it('fails the stage at once, for the user to act, when VoiceStudio is closed', async () => {
    expect(await adapter(fakeClient({}, DOWN).client).poll()).toEqual({
      done: true,
      outcome: 'failed',
      reason: DOWN.error,
      retryable: false,
      failureClass: 'user_action',
    });
    expect(await adapter(fakeClient({}, { ...UP, starting: true }).client).poll()).toEqual({
      done: false,
      phase: 'queued',
    });
    expect(await adapter(fakeClient({}).client).poll()).toEqual({
      done: true,
      outcome: 'succeeded',
    });
  });

  it('speaks a long script in pieces and joins them', async () => {
    const { client, calls } = fakeClient({ '/v1/audio/speech': 'ID3' });
    const vs = adapter(client);
    const text = `${'A sentence here. '.repeat(240)}`.trim();
    const handle = await vs.submit(speechReq({ outputFormat: 'mp3', voiceId: 'a1b2' }, text), 'k');
    const result = await vs.fetch(handle);
    expect(calls.length).toBe(2);
    expect(calls[0]!.json).toMatchObject({
      model: 'omnivoice',
      voice: 'a1b2',
      response_format: 'mp3',
    });
    expect(result.output).toMatchObject({ kind: 'media.audio', mime: 'audio/mpeg' });
    expect(result.costUsd).toBe(0);
    expect(result.timing).toBeUndefined();
  });

  it('transcribes its own speech when Word timings is on', async () => {
    const { client, calls } = fakeClient({
      '/v1/audio/speech': 'ID3',
      '/v1/audio/transcriptions': {
        text: 'Hello there.',
        duration: 1,
        words: [
          { word: 'Hello', start: 0, end: 0.4 },
          { word: 'there.', start: 0.4, end: 0.9 },
        ],
      },
    });
    const vs = adapter(client);
    const handle = await vs.submit(speechReq({ outputFormat: 'mp3', wordTimings: true }), 'k');
    const result = await vs.fetch(handle);
    expect(calls.map((c) => c.path)).toEqual(['/v1/audio/speech', '/v1/audio/transcriptions']);
    const form = calls[1]!.body as FormData;
    expect(form.get('response_format')).toBe('verbose_json');
    expect(form.getAll('timestamp_granularities[]')).toContain('word');
    expect(result.timing?.words.map((w) => w.text)).toEqual(['Hello', 'there.']);
  });

  it('says once that an error came from VoiceStudio', async () => {
    const { client } = fakeClient({
      '/v1/audio/speech': new VoiceStudioError(400, 'Unknown voice "nobody"'),
    });
    const vs = adapter(client);
    const handle = await vs.submit(speechReq({ voiceId: 'nobody' }), 'k');
    await expect(vs.fetch(handle)).rejects.toThrow('VoiceStudio: Unknown voice "nobody"');
    const down = fakeClient({});
    const closed = adapter(down.client);
    await expect(closed.fetch(await closed.submit(speechReq(), 'k'))).rejects.toThrow(
      /^VoiceStudio isn't reachable/,
    );
  });

  it('rejects settings the engine does not take before any request', async () => {
    const { client } = fakeClient({});
    await expect(adapter(client).submit(speechReq({ outputFormat: 'aac' }), 'k')).rejects.toThrow(
      /output format/,
    );
  });
});

describe('VoiceStudioAdapter.cloneFromAsset', () => {
  const dbReturning = (row: Record<string, unknown> | undefined) => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({ where: () => ({ limit: async () => (row ? [row] : []) }) }),
      }),
    }),
  });
  const file = { kind: 'media.video', name: 'talk.mp4', objectKey: 'k', mime: 'video/mp4' };

  it('refuses a file too big to hold in memory, before reading it', async () => {
    const storage = { getStream: vi.fn() };
    const vs = new VoiceStudioAdapter(
      fakeClient({}).client as never,
      storage as never,
      dbReturning({ ...file, bytes: 2_000_000_000 }) as never,
    );
    await expect(vs.cloneFromAsset({ assetId: 'a1', name: 'Me' })).rejects.toThrow(
      /2000 MB\. Use a recording under 50 MB/,
    );
    expect(storage.getStream).not.toHaveBeenCalled();
  });

  it('refuses files that are not audio or video', async () => {
    const vs = new VoiceStudioAdapter(
      fakeClient({}).client as never,
      { getStream: vi.fn() } as never,
      dbReturning({ ...file, kind: 'media.image', bytes: 10 }) as never,
    );
    await expect(vs.cloneFromAsset({ assetId: 'a1', name: 'Me' })).rejects.toThrow(
      /audio or video/,
    );
  });
});

describe('VoiceStudioClient', () => {
  const client = (key?: string) =>
    new VoiceStudioClient(
      {
        voiceStudioUrl: async () => 'http://vs:3900/',
        voiceStudio: async () => ({ url: 'http://vs:3900/', source: 'default' as const }),
      },
      {
        resolve: async () => ({ value: key, source: key ? 'saved' : null, unreadable: false }),
      },
    );

  it('sends the API key as a bearer token', async () => {
    const fetchMock = vi.fn(async () => response({ voices: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await client('secret-key-123').json('/v1/audio/voices', 1000);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://vs:3900/v1/audio/voices');
    expect(init.headers).toEqual({ Authorization: 'Bearer secret-key-123' });
  });

  it('is ready when /health is ok and the key is accepted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/health')
          ? response({ status: 'ok', device: 'cuda', version: '2.0.0' })
          : response({ voices: [] }),
      ),
    );
    expect(await client().status()).toEqual({
      url: 'http://vs:3900',
      reachable: true,
      starting: false,
      version: '2.0.0',
      device: 'cuda',
      error: null,
    });
  });

  it('asks for the API key when VoiceStudio refuses Reelcraft', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/health')
          ? response({ status: 'ok', device: 'cpu', version: '2.0.0' })
          : response({ detail: 'Unauthorized' }, 401),
      ),
    );
    const status = await client().status();
    expect(status.reachable).toBe(true);
    expect(status.error).toMatch(/API key/);
  });

  it('reports a starting VoiceStudio, and one that is not there', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ status: 'starting', version: '2.0.0' }, 503)),
    );
    expect(await client().status()).toMatchObject({ reachable: true, starting: true });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    expect(await client().status()).toMatchObject({
      reachable: false,
      error: expect.stringMatching(/isn't reachable at http:\/\/vs:3900/),
    });
  });

  it('counts as set up once its key is saved', async () => {
    expect(await client().configured()).toBe(false);
    expect(await client('secret-key-123').configured()).toBe(true);
  });

  it('never sends the saved key to an address that is only being tried', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/health')
        ? response({ status: 'ok', device: 'cpu', version: '2.0.0' })
        : response({ detail: 'Unauthorized' }, 401),
    );
    vi.stubGlobal('fetch', fetchMock);
    const status = await client('secret-key-123').status('http://attacker:3900');
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit | undefined]>;
    expect(calls.map(([url]) => url)).toEqual([
      'http://attacker:3900/health',
      'http://attacker:3900/v1/audio/voices',
    ]);
    expect(calls.every(([, init]) => !JSON.stringify(init?.headers ?? {}).includes('secret'))).toBe(
      true,
    );
    expect(status.error).toMatch(/Save the address first/);
  });

  it('asks the configured VoiceStudio once for checks close together', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/health') ? response({ status: 'ok' }) : response({ voices: [] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const vs = client();
    await Promise.all([vs.status(), vs.status(), vs.status()]);
    await vs.status();
    const health = (fetchMock.mock.calls as unknown as Array<[string]>).filter(([url]) =>
      url.endsWith('/health'),
    );
    expect(health).toHaveLength(1);
    // An address being tried is never answered from the cache.
    await vs.status('http://other:3900');
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('http://other'))).toBe(true);
  });

  it('tests an address before it is saved', async () => {
    const fetchMock = vi.fn(async () => response({ status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    await client().status('http://other:3900/v1');
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('http://other:3900/health');
  });
});
