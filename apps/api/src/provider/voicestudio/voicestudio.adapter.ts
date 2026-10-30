import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type {
  CloneVoiceStudioVoiceDto,
  CostEstimate,
  JobHandle,
  JobStatus,
  TimingMap,
  VoiceListDto,
  VoiceStudioVoiceDto,
} from '@reelcraft/shared';
import { DRIZZLE, type Db } from '../../db/drizzle.provider';
import { asset, blob } from '../../db/schema';
import { STORAGE_ADAPTER, type StorageAdapter } from '../../storage/storage.adapter';
import { filterVoices } from '../deepgram/deepgram-speech';
import type {
  ModelInfo,
  ModelIssue,
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
import {
  boolParam,
  textParam,
  validateSpeechParams,
  type SpeechParams,
} from '../speech/speech-params';
import { splitSpeechText } from '../speech/speech-text';
import { unreachableMessage, VoiceStudioClient } from './voicestudio-client';
import {
  DEFAULT_VOICE_ID,
  engineIssue,
  noEngineReason,
  engineModelInfo,
  engineVoices,
  timingFromTranscription,
  TRANSCRIBE_MODEL,
  usableEngines,
  voiceStudioOptions,
  voiceStudioRequestBody,
  VOICESTUDIO_MAX_CHARS,
  type VerboseTranscription,
  type VoiceStudioEngine,
  type VoiceStudioProfile,
} from './voicestudio-speech';

const LOOKUP_TIMEOUT_MS = 5_000;
/** The first request to an engine can load (or download) its model, which VoiceStudio allows up to
 * 20 minutes; a long piece on a CPU is slow too. */
const SPEECH_TIMEOUT_MS = 1_500_000;
const TRANSCRIBE_TIMEOUT_MS = 1_500_000;
const FAMILIES = ['wav', 'mp3', 'flac', 'opus'] as const;
/** The largest library file a voice is cloned from (the web app's limit matches). */
export const MAX_CLONE_BYTES = 50_000_000;

/** What Analyze Media's transcription needs at `fetch` time. */
interface TranscribeJob {
  objectKey: string;
  mime: string;
}

/**
 * VoiceStudio, the voice app the user installs and runs themselves, through its local API.
 * Each engine installed in VoiceStudio is a speech model here (`audio`); its transcription is
 * Analyze Media's (`media`). Everything runs on the user's computer, so it costs nothing.
 *
 * Speech and transcription are made in `fetch`. `poll` checks VoiceStudio answers first, so a
 * run that reaches the stage while it is closed fails at once with what to do, not after retries.
 */
@Injectable()
export class VoiceStudioAdapter implements ProviderAdapter {
  readonly id = 'voicestudio';
  readonly modalities = ['audio', 'media'] as const;
  private readonly logger = new Logger(VoiceStudioAdapter.name);
  /** The engines it last listed, shown while it is closed so a stage keeps its model. */
  private lastEngines: VoiceStudioEngine[] = [];
  /** Everything it last listed, usable or not, to say why an engine can't be used. */
  private lastListed: VoiceStudioEngine[] = [];

  constructor(
    @Inject(VoiceStudioClient)
    private readonly client: Pick<VoiceStudioClient, 'baseUrl' | 'request' | 'json' | 'status'>,
    @Inject(STORAGE_ADAPTER) private readonly storage: Pick<StorageAdapter, 'getStream'>,
    @Inject(DRIZZLE) private readonly db: Db,
  ) {}

  /** The installed engines as speech models, and transcription. Never fails: while VoiceStudio is
   * closed it lists the engines it last saw, each saying why it can't speak now (`unavailableModalities`,
   * which the assistant reads), and says why there are none if it never saw any. */
  async listModels(): Promise<ModelInfo[]> {
    const { engines, listed, live } = await this.engines();
    const reason = live ? undefined : ((await this.client.status()).error ?? undefined);
    if (!engines.length) {
      return [
        { ...TRANSCRIBE_MODEL, unavailableModalities: { audio: reason ?? noEngineReason(listed) } },
      ];
    }
    return [
      ...engines.map((engine) => ({
        ...engineModelInfo(engine),
        ...(reason && { unavailableModalities: { audio: reason } }),
      })),
      TRANSCRIBE_MODEL,
    ];
  }

  async checkModel(modelId: string): Promise<ModelIssue | undefined> {
    const status = await this.client.status();
    if (!status.reachable || status.starting || status.error) {
      return {
        message: `${status.error ?? unreachableMessage(status.url)} Until it is, a run stops at this stage.`,
        severity: 'warning',
      };
    }
    if (modelId === TRANSCRIBE_MODEL.modelId) return undefined;
    const issue = engineIssue(modelId, (await this.engines()).listed);
    return issue ? { message: issue, severity: 'error' } : undefined;
  }

  async listVoices(query: VoiceQuery): Promise<VoiceListDto> {
    const engine = (await this.engines()).engines.find((e) => e.id === query.modelId);
    if (!engine) return { voices: [] };
    const listed = await this.lookup<{ voices?: VoiceStudioProfile[] }>('/v1/audio/voices');
    return { voices: filterVoices(engineVoices(engine, listed?.voices ?? []), query) };
  }

  async estimate(req: ProviderRequest): Promise<CostEstimate> {
    // It runs on the user's own computer; a price set on the stage still applies.
    const expectedUsd = req.modality === 'media' ? 0 : this.text(req).length * ownPrice(req.params);
    return { expectedUsd, ceilingUsd: expectedUsd, basis: 'configured_ceiling' };
  }

  async submit(req: ProviderRequest, key: string): Promise<JobHandle> {
    if (req.modality === 'media') {
      const source = (req.params.slots as Record<string, { blobId?: string }> | undefined)?.source;
      if (!source?.blobId) throw new Error('VoiceStudio: the source media binding has no file');
      const [row] = await this.db
        .select({ objectKey: blob.objectKey, mime: blob.mime })
        .from(blob)
        .where(eq(blob.id, source.blobId))
        .limit(1);
      if (!row) throw new Error('VoiceStudio: the source media file no longer exists');
      const transcribe: TranscribeJob = { objectKey: row.objectKey, mime: row.mime };
      return { providerId: this.id, externalId: key, payload: { transcribe } };
    }
    // Every engine takes the same formats and settings; only Delivery is optional, and an
    // undeclared setting is ignored, so checking against the fullest options checks them all.
    const issues = validateSpeechParams(
      voiceStudioOptions({ id: req.modelId, instruct_vocabulary: 'freeform' }),
      req.params,
    );
    if (issues.length) throw new Error(`VoiceStudio: ${issues.map((i) => i.message).join(' ')}`);
    return { providerId: this.id, externalId: key, payload: { speech: req } };
  }

  /** The work happens in `fetch`; this only makes sure VoiceStudio is there to do it. */
  async poll(): Promise<JobStatus> {
    const status = await this.client.status();
    if (status.reachable && !status.starting && !status.error) {
      return { done: true, outcome: 'succeeded' };
    }
    if (status.starting) return { done: false, phase: 'queued' };
    return {
      done: true,
      outcome: 'failed',
      reason: status.error ?? unreachableMessage(status.url),
      retryable: false,
      failureClass: 'user_action',
    };
  }

  async fetch(handle: JobHandle): Promise<ProviderResult> {
    const payload = handle.payload as
      { speech?: ProviderRequest; transcribe?: TranscribeJob } | undefined;
    if (payload?.transcribe) return this.transcribeJob(handle, payload.transcribe);
    if (payload?.speech) return this.speak(handle, payload.speech);
    throw new Error('VoiceStudio: missing durable request');
  }

  async cancel(): Promise<{ confirmed: boolean }> {
    return { confirmed: false };
  }

  /** Transcribes audio with word timings, with the engine active in VoiceStudio. */
  async transcribe(
    audio: Buffer,
    mime: string,
    language?: string,
  ): Promise<{ timing: TimingMap; raw: VerboseTranscription }> {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(audio)], { type: mime }),
      `audio.${extensionOf(mime)}`,
    );
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');
    if (language) form.append('language', language);
    const response = await this.client.request('/v1/audio/transcriptions', {
      method: 'POST',
      body: form,
      timeoutMs: TRANSCRIBE_TIMEOUT_MS,
    });
    const raw = (await response.json()) as VerboseTranscription;
    return { timing: timingFromTranscription(raw), raw };
  }

  /**
   * Makes a VoiceStudio voice from an audio (or video) file in the channel library: VoiceStudio
   * keeps a copy of the recording as the voice's reference, and every engine that clones can
   * then speak in it. Throws `AssetNotUsable` when the asset can't be used.
   */
  async cloneFromAsset(dto: CloneVoiceStudioVoiceDto): Promise<VoiceStudioVoiceDto> {
    const [row] = await this.db
      .select({
        kind: asset.kind,
        name: asset.name,
        objectKey: blob.objectKey,
        mime: blob.mime,
        bytes: blob.bytes,
      })
      .from(asset)
      .innerJoin(blob, eq(blob.id, asset.blobId))
      .where(and(eq(asset.id, dto.assetId), isNull(asset.deletedAt)))
      .limit(1);
    if (!row) throw new AssetNotUsable('That library file no longer exists.');
    if (row.kind !== 'media.audio' && row.kind !== 'media.video') {
      throw new AssetNotUsable('Choose an audio or video file to clone the voice from.');
    }
    // The file is held in memory to upload it; a voice needs seconds of speech, not a whole video.
    if (row.bytes > MAX_CLONE_BYTES) {
      throw new AssetNotUsable(
        `That file is ${Math.round(row.bytes / 1_000_000)} MB. Use a recording under ${MAX_CLONE_BYTES / 1_000_000} MB: 5 to 30 seconds of one person speaking is enough.`,
      );
    }
    const audio = await this.read(row.objectKey);
    const form = new FormData();
    form.append('name', dto.name);
    form.append('kind', 'clone');
    form.append(
      'ref_audio',
      new Blob([new Uint8Array(audio)], { type: row.mime }),
      `reference.${extensionOf(row.mime)}`,
    );
    if (dto.transcript) form.append('ref_text', dto.transcript);
    if (dto.language) form.append('language', dto.language);
    const response = await this.client.request('/profiles', {
      method: 'POST',
      body: form,
      // Without a transcript VoiceStudio transcribes the recording first.
      timeoutMs: TRANSCRIBE_TIMEOUT_MS,
    });
    const profile = (await response.json()) as { id?: string; name?: string };
    if (!profile.id) throw new Error('VoiceStudio saved the voice but did not say its id.');
    this.logger.log(
      { providerId: this.id, voiceId: profile.id, assetId: dto.assetId },
      'voice cloned from library asset',
    );
    return { id: profile.id, name: profile.name ?? dto.name };
  }

  private async speak(handle: JobHandle, req: ProviderRequest): Promise<ProviderResult> {
    const params = req.params as SpeechParams;
    const family = (textParam(params, 'outputFormat') ?? 'wav') as AudioFamily;
    if (!FAMILIES.includes(family as (typeof FAMILIES)[number])) {
      throw new Error(`VoiceStudio: "${family}" isn't an output format it offers`);
    }
    const text = this.text(req);
    if (!text.trim()) throw new Error('VoiceStudio: there is no text to speak');
    const pieces = splitSpeechText(text, VOICESTUDIO_MAX_CHARS);
    if (pieces.length > 1 && !canJoin(family)) {
      throw new Error(
        `VoiceStudio: this text is ${text.length} characters but it takes ${VOICESTUDIO_MAX_CHARS} at a time, and ${family} audio can't be joined. Choose WAV or MP3, or shorten the text.`,
      );
    }
    const voiceId = textParam(params, 'voiceId') ?? DEFAULT_VOICE_ID;
    const ids = { providerId: this.id, jobId: handle.externalId, model: req.modelId };
    const startedAt = Date.now();
    const audio: Buffer[] = [];
    for (const [index, piece] of pieces.entries()) {
      try {
        const response = await this.client.request('/v1/audio/speech', {
          method: 'POST',
          json: voiceStudioRequestBody({
            engineId: req.modelId,
            voiceId,
            text: piece,
            format: family,
            params,
          }),
          timeoutMs: SPEECH_TIMEOUT_MS,
        });
        audio.push(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        this.logger.warn({ ...ids, piece: index + 1, err: error }, 'speech request failed');
        throw new Error(named((error as Error).message));
      }
    }
    const bytes = joinAudio(audio, family);
    let timing: TimingMap | undefined;
    if (boolParam(params, 'wordTimings')) {
      try {
        ({ timing } = await this.transcribe(
          bytes,
          audioMime(family),
          textParam(params, 'language'),
        ));
      } catch (error) {
        throw new Error(
          `VoiceStudio made the speech but couldn't time its words: ${(error as Error).message}`,
        );
      }
    }
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
      repro: {
        level: params.seed !== undefined ? 'approximate' : 'none',
        ...(params.seed !== undefined && { seed: String(params.seed) }),
        providerVersion: req.modelId,
      },
      rawResponse: { voiceId, format: family, characters: text.length, pieces: pieces.length },
      ...(timing && { timing }),
    };
  }

  /** Transcribes a stored file. Used by quality control's Include transcript; it costs nothing. */
  async transcribeStored(
    objectKey: string,
    mime: string,
  ): Promise<TimingMap & { costUsd: number }> {
    const { timing } = await this.transcribe(await this.read(objectKey), mime);
    return { ...timing, costUsd: 0 };
  }

  private async read(objectKey: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of await this.storage.getStream(objectKey)) {
      chunks.push(Buffer.from(chunk as Buffer));
    }
    return Buffer.concat(chunks);
  }

  private async transcribeJob(handle: JobHandle, job: TranscribeJob): Promise<ProviderResult> {
    const startedAt = Date.now();
    let result: Awaited<ReturnType<VoiceStudioAdapter['transcribe']>>;
    try {
      result = await this.transcribe(await this.read(job.objectKey), job.mime);
    } catch (error) {
      throw new Error(`VoiceStudio transcription: ${(error as Error).message}`);
    }
    this.logger.log(
      {
        providerId: this.id,
        jobId: handle.externalId,
        wordCount: result.timing.words.length,
        durationSec: result.timing.durationSec,
        durationMs: Date.now() - startedAt,
      },
      'provider transcription completed',
    );
    return {
      output: result.timing,
      costUsd: 0,
      repro: { level: 'none', providerVersion: TRANSCRIBE_MODEL.modelId },
      rawResponse: result.raw,
    };
  }

  /** The engines Reelcraft can use, and every engine VoiceStudio listed, from VoiceStudio
   * (`live`), else as it last listed them. */
  private async engines(): Promise<{
    engines: VoiceStudioEngine[];
    listed: VoiceStudioEngine[];
    live: boolean;
  }> {
    const answer = await this.lookup<{ backends?: VoiceStudioEngine[] }>('/engines/tts');
    if (answer?.backends) {
      this.lastListed = answer.backends;
      this.lastEngines = usableEngines(answer.backends);
    }
    return { engines: this.lastEngines, listed: this.lastListed, live: !!answer?.backends };
  }

  private text(req: ProviderRequest): string {
    return String((req.params.slots as Record<string, unknown> | undefined)?.text ?? '');
  }

  /** A quick GET, or undefined when VoiceStudio isn't running or doesn't answer. */
  private async lookup<T>(path: string): Promise<T | undefined> {
    try {
      return await this.client.json<T>(path, LOOKUP_TIMEOUT_MS);
    } catch {
      return undefined;
    }
  }
}

/** The library file asked for can't be cloned from. */
export class AssetNotUsable extends Error {}

/** An error message that says it came from VoiceStudio, once. */
const named = (message: string): string =>
  message.startsWith('VoiceStudio') ? message : `VoiceStudio: ${message}`;

/** The USD price per character a stage sets itself; VoiceStudio costs nothing to run. */
function ownPrice(params: Record<string, unknown>): number {
  const own = Number(params.pricePerCharacterUsd);
  return Number.isFinite(own) && own > 0 ? own : 0;
}

/** A file extension VoiceStudio accepts for an upload of this type. */
export function extensionOf(mime: string): string {
  const type = mime.split(';')[0]!.trim().toLowerCase();
  const known: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
    'audio/flac': 'flac',
    'audio/ogg': 'ogg',
    'audio/opus': 'ogg',
    'audio/aac': 'aac',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/webm': 'webm',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
  };
  return known[type] ?? type.split('/')[1] ?? 'bin';
}
