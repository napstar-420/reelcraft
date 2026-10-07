import { Logger } from '@nestjs/common';
import type { CostEstimate, JobHandle, PronunciationEntry, VoiceListDto } from '@reelcraft/shared';
import type { KeyProvider } from '../key-provider';
import type {
  ModelInfo,
  ProviderRequest,
  ProviderResult,
  VoiceQuery,
} from '../provider-adapter.interface';
import { audioFilename, audioMime, canJoin, joinAudio } from '../speech/speech-audio';
import { pricePerCharacter, textParam, type SpeechParams } from '../speech/speech-params';
import { splitSpeechText } from '../speech/speech-text';
import {
  DEEPGRAM_FAMILIES,
  applyPronunciations,
  deepgramConflict,
  deepgramFormat,
  deepgramOptions,
  deepgramRequest,
  filterVoices,
  isDeepgramFamily,
  type DeepgramFamily,
} from './deepgram-speech';

const REQUEST_TIMEOUT_MS = 120_000;
/** Room left for the markers pronunciations add, which count toward a request's characters. */
const PRONUNCIATION_HEADROOM = 0.85;

/** The reason in a Deepgram error body: `{ err_msg }` or `{ message }`. */
function errorReason(body: string): string {
  try {
    const parsed = JSON.parse(body) as { err_msg?: string; message?: string; err_code?: string };
    return parsed.err_msg ?? parsed.message ?? parsed.err_code ?? body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}

/** Deepgram's text-to-speech half: the voices, and one synchronous request per piece of text. */
export class DeepgramSpeech {
  private readonly logger = new Logger(DeepgramSpeech.name);
  constructor(private readonly keys: KeyProvider) {}

  models(): ModelInfo[] {
    return (Object.keys(DEEPGRAM_FAMILIES) as DeepgramFamily[]).map((family) => ({
      modelId: family,
      label: DEEPGRAM_FAMILIES[family].label,
      modalities: ['audio'],
      capabilities: {
        supportsSeed: false,
        supportsIdempotency: false,
        speech: deepgramOptions(family),
      },
    }));
  }

  voices(modelId: string, query: VoiceQuery): VoiceListDto {
    if (!isDeepgramFamily(modelId)) throw new Error(`Deepgram: unknown speech model "${modelId}"`);
    return { voices: filterVoices(DEEPGRAM_FAMILIES[modelId].voices, query) };
  }

  private family(modelId: string): DeepgramFamily {
    if (!isDeepgramFamily(modelId)) throw new Error(`Deepgram: unknown speech model "${modelId}"`);
    return modelId;
  }

  private text(req: ProviderRequest): string {
    return String((req.params.slots as Record<string, unknown> | undefined)?.text ?? '');
  }

  estimate(req: ProviderRequest): CostEstimate {
    const options = deepgramOptions(this.family(req.modelId));
    const expectedUsd = this.text(req).length * pricePerCharacter(options, req.params);
    return { expectedUsd, ceilingUsd: expectedUsd, basis: 'configured_ceiling' };
  }

  submit(req: ProviderRequest, key: string): JobHandle {
    const family = this.family(req.modelId);
    const conflict = deepgramConflict(family, req.params);
    if (conflict) throw new Error(`Deepgram: ${conflict}`);
    this.logger.log(
      { providerId: 'deepgram', jobId: key, model: req.modelId },
      'speech job submitted',
    );
    return { providerId: 'deepgram', externalId: key, payload: { speech: req } };
  }

  async fetch(handle: JobHandle): Promise<ProviderResult> {
    const req = (handle.payload as { speech?: ProviderRequest } | undefined)?.speech;
    if (!req) throw new Error('Deepgram: missing durable request');
    const apiKey = await this.keys.get('deepgram');
    if (!apiKey) throw new Error('Deepgram: no API key configured');

    const family = this.family(req.modelId);
    const spec = DEEPGRAM_FAMILIES[family];
    const params = req.params as SpeechParams;
    const format = textParam(params, 'outputFormat') ?? spec.defaultFormat;
    const { family: audioFamily } = deepgramFormat(format);
    const voiceId = textParam(params, 'voiceId') ?? spec.defaultVoice.id;
    const text = this.text(req);
    if (!text.trim()) throw new Error('Deepgram: there is no text to speak');

    const entries = Array.isArray(params.pronunciations)
      ? (params.pronunciations as PronunciationEntry[])
      : [];
    const limit = entries.length
      ? Math.floor(spec.maxChars * PRONUNCIATION_HEADROOM)
      : spec.maxChars;
    const pieces = splitSpeechText(text, limit);
    if (pieces.length > 1 && !canJoin(audioFamily)) {
      throw new Error(
        `Deepgram: this text is ${text.length} characters but ${spec.label} takes ${spec.maxChars} at a time, and ${audioFamily} audio can't be joined. Choose an MP3 or WAV format, or shorten the text.`,
      );
    }
    const ids = { providerId: 'deepgram', jobId: handle.externalId, model: req.modelId };
    const startedAt = Date.now();
    const audio: Buffer[] = [];
    for (const [index, piece] of pieces.entries()) {
      const { url, body } = deepgramRequest({
        family,
        voiceId,
        text: entries.length ? applyPronunciations(piece, entries) : piece,
        params,
        format,
      });
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' },
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
          'speech request failed',
        );
        throw new Error(
          response.status === 401 || response.status === 403
            ? `Deepgram: ${response.status} the key was rejected. Check it in Settings. ${reason}`
            : `Deepgram: ${response.status} ${reason}`,
        );
      }
      audio.push(Buffer.from(await response.arrayBuffer()));
    }
    const bytes = joinAudio(audio, audioFamily);
    this.logger.log(
      {
        ...ids,
        characters: text.length,
        pieces: pieces.length,
        bytes: bytes.length,
        durationMs: Date.now() - startedAt,
      },
      'speech job completed',
    );
    return {
      output: {
        kind: 'media.audio',
        base64: bytes.toString('base64'),
        mime: audioMime(audioFamily),
        filename: audioFilename(audioFamily),
      },
      costUsd: text.length * pricePerCharacter(deepgramOptions(family), params),
      repro: { level: 'none', providerVersion: `${spec.prefix}-${voiceId}` },
      rawResponse: { voiceId, format, characters: text.length, pieces: pieces.length },
    };
  }
}
