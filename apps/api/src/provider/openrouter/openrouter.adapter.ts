import { Inject, Injectable } from '@nestjs/common';
import type { CostEstimate, JobHandle, JobStatus } from '@reelcraft/shared';
import { KEY_PROVIDER, type KeyProvider } from '../key-provider';
import type {
  ModelInfo,
  ProviderAdapter,
  ProviderRequest,
  ProviderResult,
} from '../provider-adapter.interface';
import { ModelCacheService } from './model-cache.service';

interface OpenRouterJob {
  req: ProviderRequest;
}

const OWNED_REQUEST_FIELDS = new Set([
  '__mediaKind',
  'messages',
  'model',
  'prompt',
  'provider',
  'response_format',
  'slots',
  'stream',
]);

function forwardedParams(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(([key]) => !OWNED_REQUEST_FIELDS.has(key)),
  );
}

/**
 * §8/§16 — OpenRouter (BYOK), one adapter implementation covering text and
 * some image modalities. `text.generate` is synchronous in practice (resolves
 * on the first poll, per §2.5.4) but still implements the full lifecycle.
 */
@Injectable()
export class OpenRouterAdapter implements ProviderAdapter {
  readonly id = 'openrouter';
  readonly modalities = ['text', 'image'] as const;

  private readonly jobs = new Map<string, OpenRouterJob>();

  constructor(
    @Inject(KEY_PROVIDER) private readonly keyProvider: KeyProvider,
    private readonly modelCache: ModelCacheService,
  ) {}

  async listModels(): Promise<ModelInfo[]> {
    const cached = this.modelCache.get();
    if (cached) return cached;

    const apiKey = await this.keyProvider.get('openrouter');
    if (!apiKey) {
      throw new Error('OpenRouterAdapter.listModels: no API key configured');
    }
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`OpenRouterAdapter.listModels: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as {
      data: Array<{ id: string; name: string; supported_parameters?: string[] }>;
    };
    const models: ModelInfo[] = body.data.map((m) => ({
      modelId: m.id,
      label: m.name,
      capabilities: {
        supportsSeed: false,
        supportsIdempotency: false,
        supportsStructuredOutput: m.supported_parameters?.includes('structured_outputs') === true,
      },
    }));
    this.modelCache.set(models);
    return models;
  }

  async estimate(req: ProviderRequest): Promise<CostEstimate> {
    if (req.params.__mediaKind === 'media.image') {
      const expectedUsd = Number(req.params.priceUsd ?? 0.04);
      return { expectedUsd, ceilingUsd: expectedUsd, basis: 'configured_ceiling' };
    }
    // §16.5 — max_tokens is required in effective params for an honest
    // ceiling; without it there is no real reservation to make.
    const maxTokens = req.params.max_tokens;
    if (typeof maxTokens !== 'number') {
      throw new Error('OpenRouterAdapter.estimate: max_tokens is required in model params');
    }
    const promptTokens = (req.renderedPrompt ?? '').length / 4;
    // Placeholder per-token rate until listModels() pricing is wired through;
    // basis is honestly reported as an estimate either way.
    const ratePerToken = 0.000_002;
    const expectedUsd = (promptTokens + maxTokens) * ratePerToken;
    return { expectedUsd, ceilingUsd: expectedUsd * 1.5, basis: 'token_estimate' };
  }

  async submit(req: ProviderRequest, idempotencyKey: string): Promise<JobHandle> {
    if (req.output?.kind === 'data') {
      const model = (await this.listModels()).find(
        (candidate) => candidate.modelId === req.modelId,
      );
      if (!model) {
        throw new Error(`OpenRouter model "${req.modelId}" is not available`);
      }
      if (!model.capabilities.supportsStructuredOutput) {
        throw new Error(`OpenRouter model "${req.modelId}" does not support structured output`);
      }
    }
    this.jobs.set(idempotencyKey, { req });
    return { providerId: this.id, externalId: idempotencyKey };
  }

  async poll(_handle: JobHandle): Promise<JobStatus> {
    // sync means fast, not local (§7.2) — resolves on first poll.
    return { done: true, outcome: 'succeeded' };
  }

  async fetch(handle: JobHandle): Promise<ProviderResult> {
    const job = this.jobs.get(handle.externalId);
    if (!job) {
      throw new Error(`OpenRouterAdapter.fetch: unknown job ${handle.externalId}`);
    }
    const apiKey = await this.keyProvider.get('openrouter');
    if (!apiKey) {
      throw new Error('OpenRouterAdapter.fetch: no API key configured');
    }
    if (job.req.params.__mediaKind === 'media.image') return this.fetchImage(job.req, apiKey);
    const responseFormat =
      job.req.output?.kind === 'data'
        ? {
            type: 'json_schema',
            json_schema: {
              name: job.req.output.schemaName ?? 'stage_output',
              strict: true,
              schema: job.req.output.schema,
            },
          }
        : undefined;
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...forwardedParams(job.req.params),
        model: job.req.modelId,
        messages: [
          ...(job.req.system ? [{ role: 'system', content: job.req.system }] : []),
          { role: 'user', content: job.req.renderedPrompt ?? '' },
        ],
        ...(responseFormat && { response_format: responseFormat }),
        ...(responseFormat && { provider: { require_parameters: true } }),
        stream: false,
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenRouterAdapter.fetch: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { total_tokens?: number };
    };
    const text = body.choices[0]?.message.content ?? '';
    let output: unknown = text;
    if (job.req.output?.kind === 'data') {
      try {
        output = JSON.parse(text);
      } catch {
        throw new Error('OpenRouter returned malformed structured JSON');
      }
    }
    const totalTokens = body.usage?.total_tokens ?? 0;
    return {
      output,
      costUsd: totalTokens * 0.000_002,
      repro: { level: 'approximate', providerVersion: job.req.modelId },
      rawResponse: body,
    };
  }

  private async fetchImage(req: ProviderRequest, apiKey: string): Promise<ProviderResult> {
    const params = forwardedParams(req.params);
    const response = await fetch('https://openrouter.ai/api/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, model: req.modelId, prompt: req.renderedPrompt ?? '' }),
    });
    if (!response.ok)
      throw new Error(`OpenRouter image: ${response.status} ${response.statusText}`);
    const body = (await response.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
      usage?: { total_cost?: number };
    };
    const image = body.data?.[0];
    if (!image?.b64_json && !image?.url)
      throw new Error('OpenRouter image: missing generated image');
    return {
      output: {
        kind: 'media.image',
        ...(image.b64_json ? { base64: image.b64_json } : { sourceUrl: image.url! }),
        mime: 'image/png',
        filename: 'image.png',
      },
      costUsd: body.usage?.total_cost ?? Number(req.params.priceUsd ?? 0.04),
      repro: { level: 'none', providerVersion: req.modelId },
      rawResponse: {
        data: image.url ? [{ url: image.url }] : [{ b64_json: '[stored]' }],
        usage: body.usage,
      },
    };
  }

  async cancel(handle: JobHandle) {
    this.jobs.delete(handle.externalId);
    return { confirmed: true, billed: false };
  }
}
