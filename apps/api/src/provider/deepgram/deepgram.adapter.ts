import { Inject, Injectable } from '@nestjs/common';
import type { CostEstimate, JobHandle, JobStatus } from '@reelcraft/shared';
import { EngineConfig } from '../../config/engine-config';
import { STORAGE_ADAPTER, type StorageAdapter } from '../../storage/storage.adapter';
import { KEY_PROVIDER, type KeyProvider } from '../key-provider';
import type {
  ModelInfo,
  ProviderAdapter,
  ProviderRequest,
  ProviderResult,
} from '../provider-adapter.interface';
import { DeepgramInboxService } from './deepgram-inbox.service';
import { DRIZZLE, type Db } from '../../db/drizzle.provider';
import { blob } from '../../db/schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class DeepgramAdapter implements ProviderAdapter {
  readonly id = 'deepgram';
  readonly modalities = ['media'] as const;
  constructor(
    @Inject(KEY_PROVIDER) private readonly keys: KeyProvider,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly config: EngineConfig,
    private readonly inbox: DeepgramInboxService,
  ) {}
  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        modelId: 'nova-3',
        label: 'Deepgram Nova 3',
        capabilities: { supportsSeed: false, supportsIdempotency: true },
      },
    ];
  }
  async estimate(req: ProviderRequest): Promise<CostEstimate> {
    const expectedUsd = Number(req.params.pricePerMinuteUsd ?? 0.0043);
    return { expectedUsd, ceilingUsd: expectedUsd, basis: 'configured_ceiling' };
  }
  async submit(req: ProviderRequest, key: string): Promise<JobHandle> {
    const source = (req.params.slots as Record<string, { blobId?: string }> | undefined)?.source;
    if (!source?.blobId) throw new Error('Deepgram: source media binding lacks blob id');
    const [sourceBlob] = await this.db
      .select({ objectKey: blob.objectKey })
      .from(blob)
      .where(eq(blob.id, source.blobId))
      .limit(1);
    if (!sourceBlob) throw new Error('Deepgram: source media blob no longer exists');
    const job = await this.inbox.createOrGet(key, req);
    if ('externalId' in job && job.externalId)
      return { providerId: this.id, externalId: job.id, payload: { jobId: job.id } };
    const apiKey = await this.keys.get(this.id);
    if (!apiKey) throw new Error('Deepgram: no API key configured');
    const callback = `${this.config.publicApiBaseUrl}/api/providers/deepgram/callback?token=${job.callbackToken}`;
    const url = await this.storage.presignGet(sourceBlob.objectKey, 900);
    const response = await fetch(
      `https://api.deepgram.com/v1/listen?model=${encodeURIComponent(req.modelId)}&smart_format=true&utterances=true&callback=${encodeURIComponent(callback)}`,
      {
        method: 'POST',
        headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      },
    );
    if (!response.ok) throw new Error(`Deepgram submit: ${response.status} ${response.statusText}`);
    const body = (await response.json()) as { request_id?: string };
    await this.inbox.markSubmitted(job.id, body.request_id ?? job.id);
    return { providerId: this.id, externalId: job.id, payload: { jobId: job.id } };
  }
  async poll(handle: JobHandle): Promise<JobStatus> {
    const job = await this.inbox.get(handle.externalId);
    if (!job)
      return { done: true, outcome: 'failed', reason: 'unknown Deepgram job', retryable: false };
    return job.state === 'completed'
      ? { done: true, outcome: 'succeeded' }
      : { done: false, phase: 'running' };
  }
  async fetch(handle: JobHandle): Promise<ProviderResult> {
    const job = await this.inbox.get(handle.externalId);
    if (!job?.result) throw new Error('Deepgram: callback result unavailable');
    const output = normalize(job.result);
    return {
      output,
      costUsd: Number((job.payload as ProviderRequest).params.pricePerMinuteUsd ?? 0.0043),
      repro: { level: 'none', providerVersion: 'nova-3' },
      rawResponse: job.result,
    };
  }
  async cancel(): Promise<{ confirmed: boolean }> {
    return { confirmed: false };
  }
}

function normalize(raw: unknown) {
  const body = raw as {
    metadata?: { duration?: number };
    results?: {
      channels?: Array<{
        alternatives?: Array<{
          transcript?: string;
          words?: Array<{ word: string; start: number; end: number; confidence?: number }>;
        }>;
      }>;
    };
  };
  const alternative = body.results?.channels?.[0]?.alternatives?.[0];
  const words = (alternative?.words ?? []).map((word) => ({
    text: word.word,
    startSec: word.start,
    endSec: word.end,
    ...(word.confidence !== undefined && { confidence: word.confidence }),
  }));
  return {
    transcript: alternative?.transcript ?? '',
    durationSec: body.metadata?.duration ?? words.at(-1)?.endSec ?? 0,
    sentences: words.length
      ? [
          {
            text: alternative?.transcript ?? '',
            startSec: words[0]!.startSec,
            endSec: words.at(-1)!.endSec,
          },
        ]
      : [],
    words,
  };
}
