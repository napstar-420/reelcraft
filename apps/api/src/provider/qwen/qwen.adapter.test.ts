import { afterEach, describe, expect, it, vi } from 'vitest';
import { QwenServiceError, QwenTtsAdapter } from './qwen.adapter';
import { qwenBaseUrl, qwenErrorReason, qwenOptions, qwenRequestBody } from './qwen-speech';

const SMALL = 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice';
const BIG = 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice';

/** A runtime that is always ready: it hands `use` the service address and starts nothing. */
const fakeRuntime = (over: Record<string, unknown> = {}) => ({
  use: vi.fn(async (work: (base: string) => Promise<unknown>) => work('http://gpu:8091')),
  startsOnDemand: vi.fn(async () => false),
  readyModels: vi.fn(() => [] as string[]),
  rememberReadyModels: vi.fn(),
  ...over,
});

const adapter = (url = 'http://gpu:8091', runtime = fakeRuntime()) =>
  new QwenTtsAdapter({ qwenTtsUrl: async () => url }, runtime as never);

const reply = (body: unknown, ok = true, status = 200) =>
  ({
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    arrayBuffer: async () => Buffer.from(String(body)),
  }) as unknown as Response;

const served = (id: string, state: string, instructions = true) => ({
  id,
  label: id,
  state,
  downloadedBytes: state === 'ready' ? 10 : 0,
  totalBytes: 10,
  error: null,
  license: 'Apache-2.0',
  instructions,
  freeBytes: 99,
});

const speechReq = (params: Record<string, unknown> = {}, text = 'Hello there.') => ({
  modality: 'audio' as const,
  modelId: SMALL,
  params: { ...params, slots: { text } },
});

afterEach(() => vi.unstubAllGlobals());

describe('Qwen3-TTS request', () => {
  it('sends only the settings that are set', () => {
    const body = qwenRequestBody({
      modelId: 'm',
      voiceId: 'ryan',
      text: 'Hi',
      format: 'wav',
      params: { language: '', instructions: ' calm ' },
    });
    expect(body).toEqual({
      model: 'm',
      input: 'Hi',
      voice: 'ryan',
      response_format: 'wav',
      instructions: 'calm',
    });
  });

  it('accepts an address with a trailing slash or /v1', () => {
    expect(qwenBaseUrl('http://gpu:8091/')).toBe('http://gpu:8091');
    expect(qwenBaseUrl('http://gpu:8091/v1/')).toBe('http://gpu:8091');
  });

  it('reads the reason from OpenAI-style and FastAPI errors', () => {
    expect(qwenErrorReason('{"error":{"message":"bad voice"}}')).toBe('bad voice');
    expect(qwenErrorReason('{"detail":"nope"}')).toBe('nope');
    expect(qwenErrorReason('boom')).toBe('boom');
  });

  it('offers the delivery setting only to the model that follows it', () => {
    const keys = (instructions: boolean) => qwenOptions(instructions).settings.map((s) => s.key);
    expect(keys(true)).toEqual(['language', 'instructions']);
    expect(keys(false)).toEqual(['language']);
  });
});

describe('QwenTtsAdapter models', () => {
  it('lists both models with their download state from the service', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        reply({ data: [served(SMALL, 'ready', false), served(BIG, 'downloading')] }),
      ),
    );
    const models = await adapter().listModels();
    expect(models.map((m) => [m.modelId, m.download?.state])).toEqual([
      [SMALL, 'ready'],
      [BIG, 'downloading'],
    ]);
    expect(models[0]!.download).toMatchObject({ license: 'Apache-2.0', freeBytes: 99 });
    expect(models[0]!.download?.serviceDown).toBeUndefined();
    expect(models[0]!.capabilities.speech?.settings.map((s) => s.key)).toEqual(['language']);
    expect(models[1]!.capabilities.speech?.settings.map((s) => s.key)).toContain('instructions');
  });

  it('still lists both models, marked, when the service is not running', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('refused')));
    const models = await adapter().listModels();
    expect(models.map((m) => m.modelId)).toEqual([SMALL, BIG]);
    expect(
      models.every((m) => m.download?.serviceDown && m.download.state === 'not_downloaded'),
    ).toBe(true);
  });

  it('lists the service voices, filling in what it knows about them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply({ voices: ['ryan', 'zed'] })),
    );
    const { voices } = await adapter().listVoices({});
    expect(voices.map((v) => v.id)).toEqual(['ryan', 'zed']);
    expect(voices[0]).toMatchObject({ name: 'Ryan', gender: 'male' });
  });

  it('falls back to the known voices when the service is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('refused')));
    expect((await adapter().listVoices({})).voices.length).toBe(9);
  });
});

describe('QwenTtsAdapter downloads', () => {
  it('relays download, cancel and delete to the service', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      reply(served(SMALL, 'downloading')),
    );
    vi.stubGlobal('fetch', fetchMock);
    const a = adapter();
    expect((await a.download(SMALL)).state).toBe('downloading');
    await a.cancelDownload(SMALL);
    await a.remove(SMALL);
    expect(fetchMock.mock.calls.map((c) => [c[1]?.method, String(c[0])])).toEqual([
      ['POST', `http://gpu:8091/v1/models/${SMALL}/download`],
      ['POST', `http://gpu:8091/v1/models/${SMALL}/cancel`],
      ['DELETE', `http://gpu:8091/v1/models/${SMALL}`],
    ]);
  });

  it("passes on the service's status and reason when it refuses", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply({ error: { message: 'Not enough disk space' } }, false, 507)),
    );
    const error = await adapter()
      .download(SMALL)
      .catch((e) => e);
    expect(error).toBeInstanceOf(QwenServiceError);
    expect(error).toMatchObject({ status: 507, message: 'Not enough disk space' });
  });

  it('says how to start the service when it is not running', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(adapter().download(SMALL)).rejects.toThrow('Settings → Qwen3-TTS');
  });

  it('probes the service and reports its device', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ status: 'ok', device: 'mps' })));
    expect(await adapter().probe('http://other:1')).toEqual({ device: 'mps' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('no', false, 502)));
    await expect(adapter().probe()).rejects.toThrow('502');
  });
});

describe('QwenTtsAdapter speech', () => {
  it('speaks through /v1/audio/speech at no cost', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('RIFFaudio'));
    vi.stubGlobal('fetch', fetchMock);
    const a = adapter();
    const handle = await a.submit(speechReq({ voiceId: 'ryan' }), 'job-1');
    expect(await a.poll()).toMatchObject({ done: true, outcome: 'succeeded' });
    const result = await a.fetch(handle);
    expect(fetchMock.mock.calls[0]![0]).toBe('http://gpu:8091/v1/audio/speech');
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({
      model: SMALL,
      voice: 'ryan',
      input: 'Hello there.',
    });
    expect(result.costUsd).toBe(0);
    expect(result.output).toMatchObject({ kind: 'media.audio', mime: 'audio/wav' });
  });

  it('says what went wrong when the service rejects a request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(reply({ error: { message: "isn't downloaded" } }, false, 409)),
    );
    const a = adapter();
    await expect(a.fetch(await a.submit(speechReq(), 'j'))).rejects.toThrow("409 isn't downloaded");
  });

  it('says how to start the service when speech is asked for while it is off', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const a = adapter();
    await expect(a.fetch(await a.submit(speechReq(), 'j'))).rejects.toThrow('Settings → Qwen3-TTS');
  });

  it('rejects a format the model does not offer when the job is submitted', async () => {
    await expect(adapter().submit(speechReq({ outputFormat: 'aac' }), 'j')).rejects.toThrow(
      'output format',
    );
  });

  it('refuses a long text in a format that cannot be joined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('x')));
    const a = adapter();
    const long = 'A sentence that runs on. '.repeat(40);
    await expect(
      a.fetch(await a.submit(speechReq({ outputFormat: 'flac' }, long), 'j')),
    ).rejects.toThrow("can't be joined");
  });
});

describe('QwenTtsAdapter and the runtime that starts the service', () => {
  it('never starts the service to list models or voices, or to test a connection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply({ data: [], voices: [], device: 'cpu' })),
    );
    const runtime = fakeRuntime();
    const a = adapter('http://gpu:8091', runtime);
    await a.listModels();
    await a.listVoices({});
    await a.probe();
    expect(runtime.use).not.toHaveBeenCalled();
  });

  it('starts it for speech, downloads, cancels, deletes and linking', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/v1/audio/speech') ? reply('RIFF') : reply(served(SMALL, 'ready')),
      ),
    );
    const runtime = fakeRuntime();
    const a = adapter('http://gpu:8091', runtime);
    await a.fetch(await a.submit(speechReq(), 'j'));
    await a.download(SMALL);
    await a.cancelDownload(SMALL);
    await a.remove(SMALL);
    await a.link(SMALL, '/models/qwen');
    expect(runtime.use).toHaveBeenCalledTimes(5);
  });

  it('tells the service which folder to use, in the request body', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      reply(served(SMALL, 'ready')),
    );
    vi.stubGlobal('fetch', fetchMock);
    const download = await adapter().link(SMALL, '/models/qwen');
    expect(download.state).toBe('ready');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`http://gpu:8091/v1/models/${SMALL}/link`);
    expect(init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(String(init!.body))).toEqual({ path: '/models/qwen' });
  });

  it('remembers which models were ready whenever the service answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply({ data: [served(SMALL, 'ready'), served(BIG, 'not_downloaded')] })),
    );
    const runtime = fakeRuntime();
    await adapter('http://gpu:8091', runtime).listModels();
    expect(runtime.rememberReadyModels).toHaveBeenCalledWith([SMALL]);
  });

  it('shows what was ready, without calling the service down, while an installed one is stopped', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('refused')));
    const runtime = fakeRuntime({
      startsOnDemand: vi.fn(async () => true),
      readyModels: vi.fn(() => [SMALL]),
    });
    const models = await adapter('http://gpu:8091', runtime).listModels();
    expect(models.map((m) => [m.modelId, m.download?.state])).toEqual([
      [SMALL, 'ready'],
      [BIG, 'not_downloaded'],
    ]);
    expect(models.some((m) => m.download?.serviceDown)).toBe(false);
    expect(runtime.rememberReadyModels).not.toHaveBeenCalled();
  });

  it('calls the service down, and trusts nothing it remembered, when nothing is set up', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('refused')));
    const runtime = fakeRuntime({ readyModels: vi.fn(() => [SMALL]) }); // startsOnDemand is false
    const models = await adapter('http://gpu:8091', runtime).listModels();
    expect(models.every((m) => m.download?.state === 'not_downloaded')).toBe(true);
    expect(models.every((m) => m.download?.serviceDown)).toBe(true);
  });

  it('knows the real sizes of both models when the service cannot say', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('refused')));
    const models = await adapter().listModels();
    expect(models.map((m) => m.download?.totalBytes)).toEqual([2_498_383_610, 4_520_159_586]);
  });
});
