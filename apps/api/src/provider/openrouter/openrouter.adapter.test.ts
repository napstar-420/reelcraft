import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterAdapter } from './openrouter.adapter';
import { ModelCacheService } from './model-cache.service';

function response(
  body: unknown,
  init: { ok?: boolean; status?: number; statusText?: string } = {},
) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function fixture(files: Record<string, { bytes: string; mime: string }> = {}) {
  const keyProvider = { get: vi.fn().mockResolvedValue('openrouter-key') };
  const storage = {
    getStream: vi.fn(async (key: string) => Readable.from([Buffer.from(files[key]!.bytes)])),
    stat: vi.fn(async (key: string) => ({ bytes: 1, etag: 'e', mime: files[key]!.mime })),
  };
  const adapter = new OpenRouterAdapter(
    keyProvider as never,
    new ModelCacheService(),
    storage as never,
  );
  return { adapter, keyProvider, storage };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenRouterAdapter structured output', () => {
  it('discovers structured-output support per model and caches the catalog', async () => {
    const fetch = vi.fn().mockResolvedValue(
      response({
        data: [
          {
            id: 'structured-model',
            name: 'Structured',
            supported_parameters: ['max_tokens', 'structured_outputs'],
          },
          {
            id: 'json-object-model',
            name: 'JSON object only',
            supported_parameters: ['response_format'],
          },
          { id: 'text-model', name: 'Text', supported_parameters: ['max_tokens'] },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const { adapter } = fixture();

    await expect(adapter.listModels()).resolves.toEqual([
      expect.objectContaining({
        modelId: 'structured-model',
        capabilities: expect.objectContaining({ supportsStructuredOutput: true }),
      }),
      expect.objectContaining({
        modelId: 'json-object-model',
        capabilities: expect.objectContaining({ supportsStructuredOutput: false }),
      }),
      expect.objectContaining({
        modelId: 'text-model',
        capabilities: expect.objectContaining({ supportsStructuredOutput: false }),
      }),
    ]);
    await adapter.listModels();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('sends an engine-owned JSON Schema response format and parses Data output', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          data: [
            {
              id: 'structured-model',
              name: 'Structured',
              supported_parameters: ['structured_outputs'],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response({
          choices: [{ message: { content: '{"answer":42}' } }],
          usage: { total_tokens: 10 },
        }),
      );
    vi.stubGlobal('fetch', fetch);
    const { adapter } = fixture();
    const schema = {
      type: 'object' as const,
      properties: { answer: { type: 'number' as const } },
      required: ['answer'],
    };

    const handle = await adapter.submit(
      {
        modelId: 'structured-model',
        params: {
          max_tokens: 100,
          temperature: 0.2,
          model: 'raw-model',
          messages: [{ role: 'user', content: 'raw prompt' }],
          response_format: { type: 'text' },
          provider: { require_parameters: false, allow_fallbacks: true },
          stream: true,
          __mediaKind: 'raw-kind',
          slots: { secret: true },
        },
        renderedPrompt: 'Composed prompt',
        system: 'System prompt',
        output: { kind: 'data', schemaName: 'answer', schema },
      },
      'data-job',
    );
    await expect(adapter.fetch(handle)).resolves.toEqual(
      expect.objectContaining({ output: { answer: 42 } }),
    );

    const request = fetch.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      max_tokens: 100,
      temperature: 0.2,
      model: 'structured-model',
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Composed prompt' },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'answer', strict: true, schema },
      },
      provider: { require_parameters: true },
      stream: false,
    });
  });

  it('rejects unsupported Data models before storing a job', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response({
          data: [{ id: 'text-model', name: 'Text', supported_parameters: ['max_tokens'] }],
        }),
      ),
    );
    const { adapter } = fixture();

    await expect(
      adapter.submit(
        {
          modelId: 'text-model',
          params: { max_tokens: 100 },
          output: { kind: 'data', schema: { type: 'object' } },
        },
        'unsupported-job',
      ),
    ).rejects.toThrow(/does not support structured output/i);
    await expect(
      adapter.fetch({ providerId: 'openrouter', externalId: 'unsupported-job' }),
    ).rejects.toThrow(/unknown job/i);
  });

  it('rejects malformed Data responses but returns Text content verbatim', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          data: [
            {
              id: 'structured-model',
              name: 'Structured',
              supported_parameters: ['structured_outputs'],
            },
            { id: 'text-model', name: 'Text', supported_parameters: [] },
          ],
        }),
      )
      .mockResolvedValueOnce(response({ choices: [{ message: { content: '{bad json' } }] }))
      .mockResolvedValueOnce(
        response({ choices: [{ message: { content: '  unchanged\ntext  ' } }] }),
      );
    vi.stubGlobal('fetch', fetch);
    const { adapter } = fixture();

    const dataHandle = await adapter.submit(
      {
        modelId: 'structured-model',
        params: { max_tokens: 100 },
        output: { kind: 'data', schema: { type: 'object' } },
      },
      'malformed-job',
    );
    await expect(adapter.fetch(dataHandle)).rejects.toThrow(/malformed structured JSON/i);

    const textHandle = await adapter.submit(
      {
        modelId: 'text-model',
        params: { max_tokens: 100 },
        output: { kind: 'text' },
      },
      'text-job',
    );
    await expect(adapter.fetch(textHandle)).resolves.toEqual(
      expect.objectContaining({ output: '  unchanged\ntext  ' }),
    );
  });

  it('protects image model and prompt from raw parameters while forwarding safe values', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(response({ data: [{ b64_json: 'encoded' }], usage: { total_cost: 0.1 } }));
    vi.stubGlobal('fetch', fetch);
    const { adapter } = fixture();
    const handle = await adapter.submit(
      {
        modelId: 'image-model',
        renderedPrompt: 'Engine prompt',
        params: {
          __mediaKind: 'media.image',
          model: 'raw-model',
          prompt: 'Raw prompt',
          slots: { ignored: true },
          width: 1024,
        },
      },
      'image-job',
    );
    await adapter.fetch(handle);

    const request = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      width: 1024,
      model: 'image-model',
      prompt: 'Engine prompt',
    });
  });

  it('omits max_tokens from the request body when it is absent from params', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(response({ choices: [{ message: { content: 'reply' } }] }));
    vi.stubGlobal('fetch', fetch);
    const { adapter } = fixture();
    const handle = await adapter.submit(
      {
        modelId: 'text-model',
        params: { temperature: 0.2 },
        output: { kind: 'text' },
      },
      'no-max-tokens-job',
    );
    await adapter.fetch(handle);

    const request = fetch.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body).not.toHaveProperty('max_tokens');
    expect(body.temperature).toBe(0.2);
  });
});

describe('OpenRouterAdapter file inputs', () => {
  const catalog = response({
    data: [
      {
        id: 'vision-model',
        name: 'Vision',
        architecture: { input_modalities: ['text', 'image', 'file'] },
      },
      { id: 'text-model', name: 'Text', architecture: { input_modalities: ['text'] } },
    ],
  });
  const slots = (...sourceKeys: string[]) => ({
    files: sourceKeys.map((sourceKey, i) => ({
      name: `f${i}`,
      kind: sourceKey.endsWith('.pdf') ? 'file.document' : 'media.image',
      sourceKey,
    })),
  });

  it('maps input modalities to the file kinds it can send', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(catalog));
    const { adapter } = fixture();

    const models = await adapter.listModels();

    expect(models.map((m) => m.capabilities.inputKinds)).toEqual([['media.image'], []]);
  });

  it('attaches files as content parts chosen by MIME type', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ choices: [{ message: { content: 'a red shoe' } }] }));
    vi.stubGlobal('fetch', fetch);
    const { adapter } = fixture({
      'assets/shoe.png': { bytes: 'png', mime: 'image/png' },
      'assets/brief.pdf': { bytes: 'pdf', mime: 'application/pdf' },
    });
    // Bypass the kind guard: only the MIME-based encoding is under test here.
    vi.spyOn(adapter, 'listModels').mockResolvedValue([
      {
        modelId: 'vision-model',
        label: 'Vision',
        capabilities: {
          supportsSeed: false,
          supportsIdempotency: false,
          inputKinds: ['media.image', 'file.*'],
        },
      },
    ]);

    const handle = await adapter.submit(
      {
        modelId: 'vision-model',
        params: { slots: slots('assets/shoe.png', 'assets/brief.pdf') },
        renderedPrompt: 'Describe the shoe',
        output: { kind: 'text' },
      },
      'vision-job',
    );
    await expect(adapter.fetch(handle)).resolves.toEqual(
      expect.objectContaining({ output: 'a red shoe' }),
    );

    const body = JSON.parse(String((fetch.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe the shoe' },
          {
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${Buffer.from('png').toString('base64')}` },
          },
          {
            type: 'file',
            file: {
              filename: '2-brief.pdf',
              file_data: `data:application/pdf;base64,${Buffer.from('pdf').toString('base64')}`,
            },
          },
        ],
      },
    ]);
    expect(body).not.toHaveProperty('slots');
  });

  it('rejects files the model cannot read before storing a job', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(catalog));
    const { adapter } = fixture();

    await expect(
      adapter.submit(
        { modelId: 'text-model', params: { slots: slots('assets/shoe.png') } },
        'blind-job',
      ),
    ).rejects.toThrow(/can't read media\.image inputs/);
    await expect(
      adapter.fetch({ providerId: 'openrouter', externalId: 'blind-job' }),
    ).rejects.toThrow(/unknown job/i);
  });
});

describe('OpenRouterAdapter estimate', () => {
  it('reserves nothing and skips the ceiling when max_tokens is absent', async () => {
    const { adapter } = fixture();

    const estimate = await adapter.estimate({
      modelId: 'text-model',
      params: {},
      renderedPrompt: 'Composed prompt',
    });

    expect(estimate.ceilingUsd).toBe(0);
    expect(estimate.expectedUsd).toBeGreaterThan(0);
  });

  it('still computes a real ceiling when max_tokens is set', async () => {
    const { adapter } = fixture();

    const estimate = await adapter.estimate({
      modelId: 'text-model',
      params: { max_tokens: 100 },
      renderedPrompt: 'Composed prompt',
    });

    expect(estimate.ceilingUsd).toBeGreaterThan(0);
    expect(estimate.ceilingUsd).toBeCloseTo(estimate.expectedUsd * 1.5);
  });
});
