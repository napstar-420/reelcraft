import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CostEstimate, JobHandle, JobStatus, VoiceListDto } from '@reelcraft/shared';
import { STORAGE_ADAPTER, type StorageAdapter } from '../../storage/storage.adapter';
import { KEY_PROVIDER, type KeyProvider } from '../key-provider';
import type {
  ModelInfo,
  ProviderAdapter,
  ProviderRequest,
  ProviderResult,
  VoiceQuery,
} from '../provider-adapter.interface';
import { DeepgramSpeech, errorReason } from './deepgram-speech.service';
import { sentencesFromWords } from '../timing-sentences';
import { deepgramConflict, isDeepgramFamily } from './deepgram-speech';
import { DeepgramInboxService } from './deepgram-inbox.service';
import { DRIZZLE, type Db } from '../../db/drizzle.provider';
import { blob } from '../../db/schema';
import { eq } from 'drizzle-orm';

const DEFAULT_PRICE_PER_MINUTE_USD = 0.0043;

/** What Analyze Media's transcription needs at `fetch` time. */
interface TranscribeJob {
  objectKey: string;
  mime: string;
  modelId: string;
  pricePerMinuteUsd: number;
}

/** Deepgram bills by audio length: the per-minute price times the minutes
 * transcribed. With no known length, one minute is assumed. */
export function deepgramCostUsd(
  pricePerMinuteUsd: number,
  durationSec: number | undefined,
): number {
  if (!durationSec || !Number.isFinite(durationSec) || durationSec <= 0) return pricePerMinuteUsd;
  return Number(((pricePerMinuteUsd * durationSec) / 60).toFixed(6));
}

@Injectable()
export class DeepgramAdapter implements ProviderAdapter {
  readonly id = 'deepgram';
  /** `media` is transcription (Analyze Media); `audio` is Generate Speech. */
  readonly modalities = ['media', 'audio'] as const;
  private readonly logger = new Logger(DeepgramAdapter.name);
  private readonly speech: DeepgramSpeech;
  constructor(
    @Inject(KEY_PROVIDER) private readonly keys: KeyProvider,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly inbox: DeepgramInboxService,
  ) {
    this.speech = new DeepgramSpeech(keys);
  }
  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        modelId: 'nova-3',
        label: 'Deepgram Nova 3',
        modalities: ['media'],
        capabilities: { supportsSeed: false, supportsIdempotency: true },
      },
      ...this.speech.models(),
    ];
  }
  speechConflict(modelId: string, params: Record<string, unknown>): string | undefined {
    return isDeepgramFamily(modelId) ? deepgramConflict(modelId, params) : undefined;
  }
  async listVoices(query: VoiceQuery): Promise<VoiceListDto> {
    return this.speech.voices(query.modelId ?? 'flux', query);
  }
  async estimate(req: ProviderRequest): Promise<CostEstimate> {
    if (req.modality === 'audio') return this.speech.estimate(req);
    const rate = Number(req.params.pricePerMinuteUsd ?? DEFAULT_PRICE_PER_MINUTE_USD);
    const expectedUsd = deepgramCostUsd(rate, await this.sourceDurationSec(req));
    return { expectedUsd, ceilingUsd: expectedUsd, basis: 'configured_ceiling' };
  }

  /** Transcribes a stored audio file in one request by uploading its bytes
   * (no callback, so it also works when Deepgram can't reach this install).
   * Used by quality control's Include transcript and by Analyze Media. */
  async transcribeStored(
    objectKey: string,
    mime: string,
    options: { modelId?: string; pricePerMinuteUsd?: number } = {},
  ): Promise<ReturnType<typeof normalize> & { costUsd: number; raw: unknown }> {
    const apiKey = await this.keys.get(this.id);
    if (!apiKey) throw new Error('Deepgram: no API key configured');
    const chunks: Buffer[] = [];
    for await (const chunk of await this.storage.getStream(objectKey)) {
      chunks.push(Buffer.from(chunk as Buffer));
    }
    const modelId = options.modelId ?? 'nova-3';
    const startedAt = Date.now();
    const response = await fetch(
      `https://api.deepgram.com/v1/listen?model=${encodeURIComponent(modelId)}&smart_format=true`,
      {
        method: 'POST',
        headers: { Authorization: `Token ${apiKey}`, 'Content-Type': mime },
        body: Buffer.concat(chunks),
      },
    );
    if (!response.ok) {
      const reason = errorReason(await response.text());
      this.logger.warn(
        { providerId: this.id, model: modelId, statusCode: response.status, reason },
        'provider transcription failed',
      );
      throw new Error(`Deepgram transcription: ${response.status} ${reason}`);
    }
    const raw: unknown = await response.json();
    const output = normalize(raw);
    this.logger.log(
      {
        providerId: this.id,
        model: modelId,
        durationSec: output.durationSec,
        durationMs: Date.now() - startedAt,
      },
      'provider transcription completed',
    );
    return {
      ...output,
      costUsd: deepgramCostUsd(
        options.pricePerMinuteUsd ?? DEFAULT_PRICE_PER_MINUTE_USD,
        output.durationSec,
      ),
      raw,
    };
  }

  /** The source media's length, from the bound slot's probe or its blob row. */
  private async sourceDurationSec(req: ProviderRequest): Promise<number | undefined> {
    const source = (
      req.params.slots as
        Record<string, { blobId?: string; probe?: { durationSec?: unknown } }> | undefined
    )?.source;
    const fromSlot = Number(source?.probe?.durationSec);
    if (Number.isFinite(fromSlot) && fromSlot > 0) return fromSlot;
    if (!source?.blobId) return undefined;
    const [row] = await this.db
      .select({ probe: blob.probe })
      .from(blob)
      .where(eq(blob.id, source.blobId))
      .limit(1);
    const fromBlob = Number((row?.probe as { durationSec?: unknown } | null)?.durationSec);
    return Number.isFinite(fromBlob) && fromBlob > 0 ? fromBlob : undefined;
  }
  async submit(req: ProviderRequest, key: string): Promise<JobHandle> {
    if (req.modality === 'audio') return this.speech.submit(req, key);
    const source = (req.params.slots as Record<string, { blobId?: string }> | undefined)?.source;
    if (!source?.blobId) throw new Error('Deepgram: source media binding lacks blob id');
    const [sourceBlob] = await this.db
      .select({ objectKey: blob.objectKey, mime: blob.mime })
      .from(blob)
      .where(eq(blob.id, source.blobId))
      .limit(1);
    if (!sourceBlob) throw new Error('Deepgram: source media blob no longer exists');
    // The audio goes up with the request in `fetch`, so Deepgram needs no
    // public URL for it and no callback into this install.
    const transcribe: TranscribeJob = {
      objectKey: sourceBlob.objectKey,
      mime: sourceBlob.mime,
      modelId: req.modelId,
      pricePerMinuteUsd: Number(req.params.pricePerMinuteUsd ?? DEFAULT_PRICE_PER_MINUTE_USD),
    };
    return { providerId: this.id, externalId: key, payload: { transcribe } };
  }
  async poll(handle: JobHandle): Promise<JobStatus> {
    // Speech and transcription are made in `fetch`, so there is nothing to wait for.
    const payload = handle.payload as { speech?: unknown; transcribe?: unknown } | undefined;
    if (payload?.speech || payload?.transcribe) return { done: true, outcome: 'succeeded' };
    // Jobs submitted by URL before transcription uploaded its bytes.
    const job = await this.inbox.get(handle.externalId);
    if (!job) {
      this.logger.error({ providerId: this.id, jobId: handle.externalId }, 'provider job unknown');
      return { done: true, outcome: 'failed', reason: 'unknown Deepgram job', retryable: false };
    }
    this.logger.debug(
      { providerId: this.id, jobId: handle.externalId, state: job.state },
      'provider job polled',
    );
    return job.state === 'completed'
      ? { done: true, outcome: 'succeeded' }
      : { done: false, phase: 'running' };
  }
  async fetch(handle: JobHandle): Promise<ProviderResult> {
    if ((handle.payload as { speech?: unknown } | undefined)?.speech) {
      return this.speech.fetch(handle);
    }
    const transcribe = (handle.payload as { transcribe?: TranscribeJob } | undefined)?.transcribe;
    if (transcribe) {
      const { raw, costUsd, ...output } = await this.transcribeStored(
        transcribe.objectKey,
        transcribe.mime,
        transcribe,
      );
      return {
        output,
        costUsd,
        repro: { level: 'none', providerVersion: transcribe.modelId },
        rawResponse: raw,
      };
    }
    const job = await this.inbox.get(handle.externalId);
    if (!job?.result) {
      this.logger.warn(
        { providerId: this.id, jobId: handle.externalId },
        'provider result unavailable',
      );
      throw new Error('Deepgram: callback result unavailable');
    }
    const output = normalize(job.result);
    this.logger.log(
      {
        providerId: this.id,
        jobId: handle.externalId,
        wordCount: output.words.length,
        durationSec: output.durationSec,
      },
      'provider job completed',
    );
    return {
      output,
      costUsd: deepgramCostUsd(
        Number(
          (job.payload as ProviderRequest).params.pricePerMinuteUsd ?? DEFAULT_PRICE_PER_MINUTE_USD,
        ),
        output.durationSec,
      ),
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
          words?: Array<{
            word: string;
            punctuated_word?: string;
            start: number;
            end: number;
            confidence?: number;
          }>;
        }>;
      }>;
    };
  };
  const alternative = body.results?.channels?.[0]?.alternatives?.[0];
  // The punctuated form carries the commas and full stops the captions break on.
  const words = (alternative?.words ?? []).map((word) => ({
    text: word.punctuated_word ?? word.word,
    startSec: word.start,
    endSec: word.end,
    ...(word.confidence !== undefined && { confidence: word.confidence }),
  }));
  return {
    transcript: alternative?.transcript ?? '',
    durationSec: body.metadata?.duration ?? words.at(-1)?.endSec ?? 0,
    sentences: sentencesFromWords(words),
    words,
  };
}
