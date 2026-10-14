import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  CostEstimate,
  JobHandle,
  JobStatus,
  ModelDownload,
  VoiceListDto,
} from '@reelcraft/shared';
import { SettingsService } from '../../settings/settings.service';
import { QwenTtsRuntime } from './qwen-runtime.service';
import type {
  ModelInfo,
  ProviderAdapter,
  ProviderRequest,
  ProviderResult,
  VoiceQuery,
} from '../provider-adapter.interface';
import {
  audioFilename,
  audioMime,
  canJoin,
  joinAudio,
  type AudioFamily,
} from '../speech/speech-audio';
import { textParam, validateSpeechParams, type SpeechParams } from '../speech/speech-params';
import { splitSpeechText } from '../speech/speech-text';
import { filterVoices } from '../deepgram/deepgram-speech';
import {
  QWEN_DEFAULT_VOICE,
  QWEN_FALLBACK_MODELS,
  QWEN_KNOWN_VOICES,
  QWEN_MAX_CHARS,
  qwenBaseUrl,
  qwenErrorReason,
  qwenOptions,
  qwenRequestBody,
  qwenVoice,
} from './qwen-speech';

/** A local model can take a while on a long piece, especially on a CPU. */
const REQUEST_TIMEOUT_MS = 600_000;
const LOOKUP_TIMEOUT_MS = 3_000;
const ACTION_TIMEOUT_MS = 30_000;
const FAMILIES = ['wav', 'mp3', 'flac', 'opus'] as const;

/** What the service says about one model (`GET /v1/models`). */
interface ServiceModel {
  id: string;
  label: string;
  state: ModelDownload['state'];
  downloadedBytes: number;
  totalBytes: number;
  error: string | null;
  license: string;
  instructions: boolean;
  freeBytes?: number;
}

/** The service answered, but not with success. `status` is its HTTP status. */
export class QwenServiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Qwen3-TTS through the local `services/qwen-tts` service, which downloads the model on
 * request and serves an OpenAI-style `/v1/audio/speech`. Speech is made in `fetch`, one
 * request per piece of text.
 */
@Injectable()
export class QwenTtsAdapter implements ProviderAdapter {
  readonly id = 'qwen-tts';
  readonly modalities = ['audio'] as const;
  private readonly logger = new Logger(QwenTtsAdapter.name);

  constructor(
    @Inject(SettingsService) private readonly settings: Pick<SettingsService, 'qwenTtsUrl'>,
    @Inject(QwenTtsRuntime)
    private readonly runtime: Pick<
      QwenTtsRuntime,
      'use' | 'startsOnDemand' | 'readyModels' | 'rememberReadyModels'
    >,
  ) {}

  /**
   * Both models, with whether each has been downloaded. Listing never starts the service (the UI
   * polls it). When the service isn't answering: if Reelcraft can start it on demand, the models
   * it last saw ready are shown as ready; otherwise they are listed as not downloaded and marked
   * `serviceDown`, which is what makes the UI offer to set it up.
   */
  async listModels(): Promise<ModelInfo[]> {
    const served = await this.lookup<{ data?: ServiceModel[] }>('/v1/models');
    let models: ServiceModel[];
    let serviceDown = false;
    if (served?.data) {
      models = served.data;
      this.runtime.rememberReadyModels(models.filter((m) => m.state === 'ready').map((m) => m.id));
    } else {
      const onDemand = await this.runtime.startsOnDemand();
      const ready = new Set(onDemand ? this.runtime.readyModels() : []);
      serviceDown = !onDemand;
      models = QWEN_FALLBACK_MODELS.map((m) => ({
        ...m,
        state: ready.has(m.id) ? ('ready' as const) : ('not_downloaded' as const),
        downloadedBytes: ready.has(m.id) ? m.totalBytes : 0,
        error: null,
      }));
    }
    return models.map((m) => ({
      modelId: m.id,
      label: m.label,
      modalities: ['audio'],
      capabilities: {
        supportsSeed: false,
        supportsIdempotency: false,
        speech: qwenOptions(m.instructions),
      },
      download: toDownload(m, serviceDown),
    }));
  }

  async listVoices(query: VoiceQuery): Promise<VoiceListDto> {
    const served = await this.lookup<{ voices?: unknown[] }>('/v1/audio/voices');
    const names = served?.voices?.filter((v): v is string => typeof v === 'string');
    const voices = names?.length ? names.map(qwenVoice) : QWEN_KNOWN_VOICES;
    return { voices: filterVoices(voices, query) };
  }

  async estimate(req: ProviderRequest): Promise<CostEstimate> {
    // Running it costs nothing but the electricity; a price set on the stage still applies.
    const expectedUsd = this.text(req).length * ownPrice(req.params);
    return { expectedUsd, ceilingUsd: expectedUsd, basis: 'configured_ceiling' };
  }

  async submit(req: ProviderRequest, key: string): Promise<JobHandle> {
    // Every model shares the formats and the language list; only Delivery differs, and an
    // undeclared setting is ignored, so the larger model's options check all of them.
    const issues = validateSpeechParams(qwenOptions(true), req.params);
    if (issues.length) throw new Error(`Qwen3-TTS: ${issues.map((i) => i.message).join(' ')}`);
    return { providerId: this.id, externalId: key, payload: { speech: req } };
  }

  async poll(): Promise<JobStatus> {
    return { done: true, outcome: 'succeeded' };
  }

  /** Makes the speech. Starts the service first if it is installed but stopped. */
  fetch(handle: JobHandle): Promise<ProviderResult> {
    return this.runtime.use((base) => this.speak(handle, base));
  }

  private async speak(handle: JobHandle, base: string): Promise<ProviderResult> {
    const req = (handle.payload as { speech?: ProviderRequest } | undefined)?.speech;
    if (!req) throw new Error('Qwen3-TTS: missing durable request');
    const params = req.params as SpeechParams;
    const family = (textParam(params, 'outputFormat') ?? 'wav') as AudioFamily;
    if (!FAMILIES.includes(family as (typeof FAMILIES)[number])) {
      throw new Error(`Qwen3-TTS: "${family}" isn't an output format it offers`);
    }
    const text = this.text(req);
    if (!text.trim()) throw new Error('Qwen3-TTS: there is no text to speak');
    const pieces = splitSpeechText(text, QWEN_MAX_CHARS);
    if (pieces.length > 1 && !canJoin(family)) {
      throw new Error(
        `Qwen3-TTS: this text is ${text.length} characters but it takes ${QWEN_MAX_CHARS} at a time, and ${family} audio can't be joined. Choose WAV or MP3, or shorten the text.`,
      );
    }
    const voiceId = textParam(params, 'voiceId') ?? QWEN_DEFAULT_VOICE.id;
    const ids = { providerId: this.id, jobId: handle.externalId, model: req.modelId };
    const startedAt = Date.now();
    const audio: Buffer[] = [];
    for (const [index, piece] of pieces.entries()) {
      let response: Response;
      try {
        response = await fetch(`${base}/v1/audio/speech`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            qwenRequestBody({ modelId: req.modelId, voiceId, text: piece, format: family, params }),
          ),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        throw new Error(unreachable(base, error));
      }
      if (!response.ok) {
        const reason = qwenErrorReason(await response.text());
        this.logger.warn(
          { ...ids, statusCode: response.status, piece: index + 1 },
          'speech request failed',
        );
        throw new Error(`Qwen3-TTS: ${response.status} ${reason}`);
      }
      audio.push(Buffer.from(await response.arrayBuffer()));
    }
    const bytes = joinAudio(audio, family);
    this.logger.log(
      {
        ...ids,
        characters: text.length,
        pieces: pieces.length,
        durationMs: Date.now() - startedAt,
      },
      'speech job completed',
    );
    return {
      output: {
        kind: 'media.audio',
        base64: bytes.toString('base64'),
        mime: audioMime(family),
        filename: audioFilename(family),
      },
      costUsd: text.length * ownPrice(params),
      repro: { level: 'none', providerVersion: req.modelId },
      rawResponse: { voiceId, format: family, characters: text.length, pieces: pieces.length },
    };
  }

  async cancel(): Promise<{ confirmed: boolean }> {
    return { confirmed: false };
  }

  /** Checks the service answers; `url` is the one being tried, else the saved one. */
  async probe(url?: string): Promise<{ device: string | null }> {
    const base = url ? qwenBaseUrl(url) : await this.baseUrl();
    let response: Response;
    try {
      response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
    } catch (error) {
      throw new Error(unreachable(base, error));
    }
    if (!response.ok) throw new Error(`the service answered ${response.status}`);
    return { device: ((await response.json()) as { device?: string | null }).device ?? null };
  }

  /** Starts downloading a model; the service carries on in the background. */
  download(modelId: string): Promise<ModelDownload> {
    return this.act('POST', modelId, 'download');
  }

  cancelDownload(modelId: string): Promise<ModelDownload> {
    return this.act('POST', modelId, 'cancel');
  }

  /** Deletes a downloaded model's files to free the disk. A linked folder is only forgotten. */
  remove(modelId: string): Promise<ModelDownload> {
    return this.act('DELETE', modelId);
  }

  /** Uses model files the user already has, in place: the service checks the folder first. */
  link(modelId: string, folder: string): Promise<ModelDownload> {
    return this.act('POST', modelId, 'link', { path: folder });
  }

  /** A request to the service about a model. Starts the service first if it is installed but stopped. */
  private act(
    method: 'POST' | 'DELETE',
    modelId: string,
    action?: string,
    body?: Record<string, unknown>,
  ): Promise<ModelDownload> {
    return this.runtime.use(async (base) => {
      let response: Response;
      try {
        response = await fetch(`${base}/v1/models/${modelId}${action ? `/${action}` : ''}`, {
          method,
          ...(body && {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
          signal: AbortSignal.timeout(ACTION_TIMEOUT_MS),
        });
      } catch (error) {
        throw new Error(unreachable(base, error));
      }
      if (!response.ok) {
        throw new QwenServiceError(response.status, qwenErrorReason(await response.text()));
      }
      return toDownload((await response.json()) as ServiceModel, false);
    });
  }

  private text(req: ProviderRequest): string {
    return String((req.params.slots as Record<string, unknown> | undefined)?.text ?? '');
  }

  private async baseUrl(): Promise<string> {
    return qwenBaseUrl(await this.settings.qwenTtsUrl());
  }

  /** A quick GET against the service, or undefined when it isn't running or doesn't answer. */
  private async lookup<T>(path: string): Promise<T | undefined> {
    try {
      const response = await fetch(`${await this.baseUrl()}${path}`, {
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      });
      return response.ok ? ((await response.json()) as T) : undefined;
    } catch {
      return undefined;
    }
  }
}

/** The USD price per character a stage sets itself; the model costs nothing to run. */
function ownPrice(params: Record<string, unknown>): number {
  const own = Number(params.pricePerCharacterUsd);
  return Number.isFinite(own) && own > 0 ? own : 0;
}

function toDownload(m: ServiceModel, serviceDown: boolean): ModelDownload {
  return {
    state: m.state,
    downloadedBytes: m.downloadedBytes,
    totalBytes: m.totalBytes,
    license: m.license,
    ...(m.error && { error: m.error }),
    ...(m.freeBytes !== undefined && { freeBytes: m.freeBytes }),
    ...(serviceDown && { serviceDown: true }),
  };
}

function unreachable(base: string, error: unknown): string {
  return `Qwen3-TTS: could not reach the service at ${base}. Check it in Settings → Qwen3-TTS. ${(error as Error).message}`;
}
