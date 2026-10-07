import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  CostEstimate,
  JobHandle,
  JobStatus,
  PronunciationDictionaryListDto,
  SpeechModelOptions,
  VoiceListDto,
} from '@reelcraft/shared';
import { KEY_PROVIDER, type KeyProvider } from '../key-provider';
import type {
  ModelInfo,
  ProviderAdapter,
  ProviderRequest,
  ProviderResult,
  VoiceQuery,
} from '../provider-adapter.interface';
import { audioFilename, audioMime, canJoin, joinAudio } from '../speech/speech-audio';
import {
  boolParam,
  pricePerCharacter,
  textParam,
  type SpeechParams,
} from '../speech/speech-params';
import { splitSpeechText } from '../speech/speech-text';
import {
  ELEVENLABS_DEFAULT_FORMAT,
  ELEVENLABS_MODELS,
  elevenLabsFormatFamily,
  elevenLabsOptions,
  elevenLabsRequest,
  specFromLive,
  timingFromPieces,
  type CharacterAlignment,
  toVoiceInfo,
  type ElevenLabsModelSpec,
  type LiveElevenLabsModel,
} from './elevenlabs-speech';

const API = 'https://api.elevenlabs.io';
const MODELS_TTL_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 120_000;

const staticModels = (): ModelInfo[] =>
  Object.entries(ELEVENLABS_MODELS).map(([modelId, spec]) => toModelInfo(modelId, spec.name, spec));

function toModelInfo(modelId: string, label: string, spec: ElevenLabsModelSpec): ModelInfo {
  return {
    modelId,
    label,
    modalities: ['audio'],
    capabilities: {
      supportsSeed: true,
      supportsIdempotency: false,
      speech: elevenLabsOptions(spec),
    },
  };
}

/** The reason in an ElevenLabs error body, which comes as `{ detail: { message } }` or `{ detail: [{ msg }] }`. */
function errorReason(body: string): string {
  try {
    const detail = (JSON.parse(body) as { detail?: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) return detail.map((d) => (d as { msg?: string }).msg).join('; ');
    const message = (detail as { message?: string } | undefined)?.message;
    if (message) return message;
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return body.slice(0, 200);
}

@Injectable()
export class ElevenLabsAdapter implements ProviderAdapter {
  readonly id = 'elevenlabs';
  readonly modalities = ['audio'] as const;
  private readonly logger = new Logger(ElevenLabsAdapter.name);
  private readonly jobs = new Map<string, ProviderRequest>();
  private models: { at: number; key: string; list: ModelInfo[] } | undefined;
  constructor(@Inject(KEY_PROVIDER) private readonly keys: KeyProvider) {}

  /** The models the account can use, as ElevenLabs lists them, or the known ones when it can't be asked. */
  async listModels(): Promise<ModelInfo[]> {
    const key = await this.keys.get(this.id);
    if (!key) return staticModels();
    if (this.models && this.models.key === key && Date.now() - this.models.at < MODELS_TTL_MS) {
      return this.models.list;
    }
    try {
      const response = await fetch(`${API}/v1/models`, {
        headers: { 'xi-api-key': key, accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const live = ((await response.json()) as LiveElevenLabsModel[]).filter(
        (m) => m.can_do_text_to_speech,
      );
      if (!live.length) return staticModels();
      const known = Object.keys(ELEVENLABS_MODELS);
      const rank = (id: string) => (known.includes(id) ? known.indexOf(id) : known.length);
      const list = live
        .sort((a, b) => rank(a.model_id) - rank(b.model_id))
        .map((m) =>
          toModelInfo(m.model_id, ELEVENLABS_MODELS[m.model_id]?.name ?? m.name, specFromLive(m)),
        );
      this.models = { at: Date.now(), key, list };
      return list;
    } catch (error) {
      this.logger.warn({ providerId: this.id, err: error }, 'live model list unavailable');
      return staticModels();
    }
  }

  /** The voices the account can use, one page at a time. */
  async listVoices(query: VoiceQuery): Promise<VoiceListDto> {
    const key = await this.keys.get(this.id);
    if (!key) throw new Error('ElevenLabs: no API key configured');
    const params = new URLSearchParams({ page_size: String(Math.min(query.limit ?? 30, 100)) });
    if (query.search) params.set('search', query.search);
    if (query.cursor) params.set('next_page_token', query.cursor);
    if (query.gender) params.set('gender', query.gender);
    if (query.language) params.append('language', query.language);
    const response = await fetch(`${API}/v2/voices?${params}`, {
      headers: { 'xi-api-key': key, accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`ElevenLabs: ${response.status} ${errorReason(await response.text())}`);
    }
    const body = (await response.json()) as {
      voices: Parameters<typeof toVoiceInfo>[0][];
      has_more?: boolean;
      next_page_token?: string | null;
    };
    return {
      voices: body.voices.map(toVoiceInfo),
      ...(body.has_more && body.next_page_token && { nextCursor: body.next_page_token }),
    };
  }

  /** The pronunciation dictionaries of the account. */
  async listPronunciationDictionaries(): Promise<PronunciationDictionaryListDto> {
    const key = await this.keys.get(this.id);
    if (!key) throw new Error('ElevenLabs: no API key configured');
    const response = await fetch(
      `${API}/v1/pronunciation-dictionaries?page_size=100&include_archived=false`,
      {
        headers: { 'xi-api-key': key, accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) {
      throw new Error(`ElevenLabs: ${response.status} ${errorReason(await response.text())}`);
    }
    const body = (await response.json()) as {
      pronunciation_dictionaries: { id: string; name: string; latest_version_id?: string | null }[];
    };
    return {
      dictionaries: body.pronunciation_dictionaries.map((d) => ({
        id: d.id,
        name: d.name,
        ...(d.latest_version_id && { versionId: d.latest_version_id }),
      })),
    };
  }

  private async speechOptions(modelId: string): Promise<SpeechModelOptions> {
    const model = (await this.listModels()).find((m) => m.modelId === modelId);
    const known = ELEVENLABS_MODELS[modelId];
    return (
      model?.capabilities.speech ??
      elevenLabsOptions(known ?? ELEVENLABS_MODELS.eleven_multilingual_v2!)
    );
  }

  private spokenText(req: ProviderRequest): string {
    const slots = req.params.slots as Record<string, unknown> | undefined;
    return String(slots?.text ?? '');
  }

  async estimate(req: ProviderRequest): Promise<CostEstimate> {
    const options = await this.speechOptions(req.modelId);
    const expectedUsd = this.spokenText(req).length * pricePerCharacter(options, req.params);
    return { expectedUsd, ceilingUsd: expectedUsd, basis: 'configured_ceiling' };
  }

  async submit(req: ProviderRequest, key: string): Promise<JobHandle> {
    this.jobs.set(key, req);
    this.logger.log(
      { providerId: this.id, jobId: key, model: req.modelId },
      'provider job submitted',
    );
    return { providerId: this.id, externalId: key, payload: req };
  }

  async poll(): Promise<JobStatus> {
    return { done: true, outcome: 'succeeded' };
  }

  async fetch(handle: JobHandle): Promise<ProviderResult> {
    const req = this.jobs.get(handle.externalId) ?? (handle.payload as ProviderRequest | undefined);
    if (!req) throw new Error('ElevenLabs: missing durable request');
    const apiKey = await this.keys.get(this.id);
    if (!apiKey) throw new Error('ElevenLabs: no API key configured');

    const params = req.params as SpeechParams;
    const options = await this.speechOptions(req.modelId);
    const format =
      textParam(params, 'outputFormat') ?? options.defaultFormat ?? ELEVENLABS_DEFAULT_FORMAT;
    const family = elevenLabsFormatFamily(format);
    // Voices are per account, so there is no safe default to fall back on.
    const voiceId = textParam(params, 'voiceId');
    if (!voiceId) {
      throw new Error("ElevenLabs: no voice is chosen. Pick one in the stage's Model section.");
    }
    const text = this.spokenText(req);
    if (!text.trim()) throw new Error('ElevenLabs: there is no text to speak');

    const pieces = splitSpeechText(text, options.maxChars);
    if (pieces.length > 1 && !canJoin(family)) {
      throw new Error(
        `ElevenLabs: this text is ${text.length} characters but ${req.modelId} takes ${options.maxChars} at a time, and ${family} audio can't be joined. Choose an MP3 or WAV format, or shorten the text.`,
      );
    }
    const stitching = ELEVENLABS_MODELS[req.modelId]?.stitching === true;
    const ids = { providerId: this.id, jobId: handle.externalId, model: req.modelId };
    const startedAt = Date.now();
    const audio: Buffer[] = [];
    const aligned: { text: string; alignment: CharacterAlignment }[] = [];
    const withTimestamps = boolParam(params, 'wordTimings') === true;
    let mime: string | undefined;
    for (const [index, piece] of pieces.entries()) {
      const { url, body } = elevenLabsRequest({
        voiceId,
        modelId: req.modelId,
        text: piece,
        params,
        format,
        withTimestamps,
        ...(stitching && { previousText: pieces[index - 1], nextText: pieces[index + 1] }),
      });
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'content-type': 'application/json',
          accept: withTimestamps ? 'application/json' : audioMime(family),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        const reason = errorReason(await response.text());
        this.logger.warn(
          {
            ...ids,
            statusCode: response.status,
            piece: index + 1,
            durationMs: Date.now() - startedAt,
          },
          'provider http request failed',
        );
        throw new Error(
          response.status === 401
            ? `ElevenLabs: 401 the key was rejected. Check it in Settings. ${reason}`
            : `ElevenLabs: ${response.status} ${reason}`,
        );
      }
      if (withTimestamps) {
        const body = (await response.json()) as {
          audio_base64: string;
          alignment?: CharacterAlignment | null;
        };
        audio.push(Buffer.from(body.audio_base64, 'base64'));
        if (body.alignment) aligned.push({ text: piece, alignment: body.alignment });
      } else {
        audio.push(Buffer.from(await response.arrayBuffer()));
        mime ??= response.headers.get('content-type') ?? undefined;
      }
    }
    const bytes = joinAudio(audio, family);
    this.logger.log(
      {
        ...ids,
        characters: text.length,
        pieces: pieces.length,
        bytes: bytes.length,
        durationMs: Date.now() - startedAt,
      },
      'provider job completed',
    );
    const seed = typeof params.seed === 'number' ? params.seed : undefined;
    return {
      output: {
        kind: 'media.audio',
        base64: bytes.toString('base64'),
        mime: pieces.length > 1 ? audioMime(family) : (mime ?? audioMime(family)),
        filename: audioFilename(family),
      },
      costUsd: text.length * pricePerCharacter(options, params),
      ...(aligned.length > 0 && { timing: timingFromPieces(aligned) }),
      repro: {
        level: seed === undefined ? 'none' : 'approximate',
        ...(seed !== undefined && { seed: String(seed) }),
        providerVersion: req.modelId,
      },
      rawResponse: { voiceId, format, characters: text.length, pieces: pieces.length },
    };
  }

  async cancel(): Promise<{ confirmed: boolean; billed?: boolean }> {
    return { confirmed: false };
  }
}
