import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CostEstimate, JobHandle, JobStatus } from '@reelcraft/shared';
import { KEY_PROVIDER, type KeyProvider } from '../key-provider';
import type {
  ModelInfo,
  ProviderAdapter,
  ProviderRequest,
  ProviderResult,
} from '../provider-adapter.interface';

interface FalHandle {
  statusUrl: string;
  responseUrl: string;
  cancelUrl: string;
  modelId: string;
}
@Injectable()
export class FalAdapter implements ProviderAdapter {
  readonly id = 'fal';
  readonly modalities = ['video'] as const;
  private readonly logger = new Logger(FalAdapter.name);
  constructor(@Inject(KEY_PROVIDER) private readonly keys: KeyProvider) {}
  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        modelId: 'fal-ai/kling-video/v3/standard',
        label: 'Kling Video v3 Standard',
        capabilities: {
          maxRefs: 4,
          supportsSeed: false,
          supportsIdempotency: false,
          video: {
            durationsSec: [5, 10],
            aspectRatios: ['16:9', '9:16', '1:1'],
            maxResolution: '1920x1080',
            inputs: ['text', 'startFrame', 'endFrame', 'references'],
            hasAudio: true,
          },
        },
      },
    ];
  }
  async estimate(req: ProviderRequest): Promise<CostEstimate> {
    const seconds = Number(req.params.duration ?? 5);
    const expectedUsd = seconds * Number(req.params.pricePerSecondUsd ?? 0.12);
    return { expectedUsd, ceilingUsd: expectedUsd, basis: 'configured_ceiling' };
  }
  async submit(req: ProviderRequest, key: string): Promise<JobHandle> {
    const apiKey = await this.keys.get(this.id);
    if (!apiKey) throw new Error('fal: no API key configured');
    const endpoint = `https://queue.fal.run/${req.modelId}`;
    const payload = {
      ...req.params,
      prompt: req.renderedPrompt,
      enable_audio: req.params.enable_audio ?? true,
    };
    delete (payload as Record<string, unknown>).__mediaKind;
    const startedAt = Date.now();
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Key ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      this.logger.warn(
        { providerId: this.id, model: req.modelId, statusCode: response.status },
        'provider job submit failed',
      );
      throw new Error(`fal submit: ${response.status} ${response.statusText}`);
    }
    const body = (await response.json()) as {
      request_id: string;
      status_url: string;
      response_url: string;
      cancel_url: string;
    };
    this.logger.log(
      {
        providerId: this.id,
        jobId: body.request_id,
        model: req.modelId,
        durationMs: Date.now() - startedAt,
      },
      'provider job submitted',
    );
    return {
      providerId: this.id,
      externalId: body.request_id,
      payload: {
        statusUrl: body.status_url,
        responseUrl: body.response_url,
        cancelUrl: body.cancel_url,
        modelId: req.modelId,
      } satisfies FalHandle,
    };
  }
  async poll(handle: JobHandle): Promise<JobStatus> {
    const h = handle.payload as FalHandle;
    const key = await this.keys.get(this.id);
    const response = await fetch(h.statusUrl, { headers: { Authorization: `Key ${key}` } });
    const ids = { providerId: this.id, jobId: handle.externalId, model: h.modelId };
    if (!response.ok) {
      this.logger.warn({ ...ids, statusCode: response.status }, 'provider job poll failed');
      throw new Error(`fal poll: ${response.status}`);
    }
    const body = (await response.json()) as { status: string };
    this.logger.debug({ ...ids, state: body.status }, 'provider job polled');
    if (body.status === 'COMPLETED') {
      this.logger.log(ids, 'provider job succeeded');
      return { done: true, outcome: 'succeeded' };
    }
    if (['FAILED', 'CANCELLED'].includes(body.status)) {
      this.logger.error({ ...ids, state: body.status }, 'provider job failed');
      return { done: true, outcome: 'failed', reason: `fal ${body.status}`, retryable: false };
    }
    return { done: false, phase: body.status === 'IN_QUEUE' ? 'queued' : 'running' };
  }
  async fetch(handle: JobHandle): Promise<ProviderResult> {
    const h = handle.payload as FalHandle;
    const key = await this.keys.get(this.id);
    const response = await fetch(h.responseUrl, { headers: { Authorization: `Key ${key}` } });
    const ids = { providerId: this.id, jobId: handle.externalId, model: h.modelId };
    if (!response.ok) {
      this.logger.warn({ ...ids, statusCode: response.status }, 'provider result fetch failed');
      throw new Error(`fal fetch: ${response.status}`);
    }
    const body = (await response.json()) as {
      video?: { url?: string };
      data?: { video?: { url?: string } };
    };
    const sourceUrl = body.video?.url ?? body.data?.video?.url;
    if (!sourceUrl) {
      this.logger.warn(ids, 'provider result missing video url');
      throw new Error('fal fetch: missing video url');
    }
    this.logger.log(ids, 'provider job completed');
    return {
      output: { kind: 'media.video', sourceUrl, mime: 'video/mp4', filename: 'video.mp4' },
      costUsd: 0,
      repro: { level: 'none', providerVersion: h.modelId },
      rawResponse: body,
    };
  }
  async cancel(handle: JobHandle) {
    const h = handle.payload as FalHandle;
    const key = await this.keys.get(this.id);
    const response = await fetch(h.cancelUrl, {
      method: 'PUT',
      headers: { Authorization: `Key ${key}` },
    });
    if (!response.ok)
      this.logger.warn(
        { providerId: this.id, jobId: handle.externalId, statusCode: response.status },
        'provider job cancel failed',
      );
    else
      this.logger.log({ providerId: this.id, jobId: handle.externalId }, 'provider job cancelled');
    return { confirmed: response.ok, billed: !response.ok };
  }
}
