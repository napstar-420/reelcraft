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

function fixture() {
  const keyProvider = { get: vi.fn().mockResolvedValue('openrouter-key') };
  const adapter = new OpenRouterAdapter(keyProvider as never, new ModelCacheService());
  return { adapter, keyProvider };
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
});
