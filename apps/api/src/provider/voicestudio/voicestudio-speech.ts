import type {
  SpeechFormat,
  SpeechModelOptions,
  SpeechSetting,
  TimingMap,
  VoiceInfo,
} from '@reelcraft/shared';
import type { ModelInfo } from '../provider-adapter.interface';
import type { AudioFamily } from '../speech/speech-audio';
import { numberParam, textParam, type SpeechParams } from '../speech/speech-params';
import { sentencesFromWords } from '../timing-sentences';

/** One speech engine, as VoiceStudio's `GET /engines/tts` lists it (the fields Reelcraft reads). */
export interface VoiceStudioEngine {
  id: string;
  display_name?: string;
  /** Installed and able to run on this computer. */
  available?: boolean;
  /** `null` when it depends on the engine's model. */
  supports_cloning?: boolean | null;
  /** How the engine reads a style instruction: `freeform` text, or a closed list of `tags`. */
  instruct_vocabulary?: 'tags' | 'freeform';
  expression_caps?: { tags?: string[] };
  /** Built-in voices a request can pick by name. */
  preset_voices?: string[];
  default_voice?: string | null;
  license_required?: boolean;
  license_accepted?: boolean;
}

/** A voice the user saved in VoiceStudio (`GET /v1/audio/voices`, `type: "profile"`). */
export interface VoiceStudioProfile {
  voice_id: string;
  name: string;
  type: string;
  language?: string | null;
}

/** The voice VoiceStudio uses when none is picked: the engine's own default. */
export const DEFAULT_VOICE_ID = 'default';

/** Characters one request takes (VoiceStudio's limit is 4096). Longer scripts are split and joined. */
export const VOICESTUDIO_MAX_CHARS = 4000;

/** The one transcription model: VoiceStudio always transcribes with the engine active in it. */
export const TRANSCRIBE_MODEL_ID = 'transcribe';

/** Engines Reelcraft can use now: installed, and with any licence they need accepted in VoiceStudio. */
export const usableEngines = (engines: VoiceStudioEngine[]): VoiceStudioEngine[] =>
  engines.filter(
    (engine) => engine.available === true && (!engine.license_required || engine.license_accepted),
  );

const needsLicence = (engine: VoiceStudioEngine) =>
  engine.license_required === true && !engine.license_accepted;

const names = (engines: VoiceStudioEngine[]) =>
  engines.map((engine) => engine.display_name || engine.id).join(', ');

/** Why VoiceStudio offers no engine to speak with, from everything `/engines/tts` listed. */
export function noEngineReason(listed: VoiceStudioEngine[]): string {
  const installed = listed.filter((engine) => engine.available === true);
  if (installed.length && installed.every(needsLicence)) {
    return `VoiceStudio's speech engines (${names(installed)}) need their licence accepted in VoiceStudio's Model Catalogue before Reelcraft can use them.`;
  }
  if (listed.length) {
    return `None of VoiceStudio's speech engines is ready on this computer. Install one, or finish setting one up, in VoiceStudio's Model Catalogue.`;
  }
  return 'VoiceStudio has no speech engine installed. Install one in VoiceStudio’s Model Catalogue.';
}

/** Why one engine a stage is pinned to can't be used, or undefined when it can. */
export function engineIssue(engineId: string, listed: VoiceStudioEngine[]): string | undefined {
  const engine = listed.find((candidate) => candidate.id === engineId);
  if (!engine) {
    return `VoiceStudio has no installed engine "${engineId}". Install it in VoiceStudio, or choose another engine.`;
  }
  if (engine.available !== true) {
    return `${names([engine])} isn't ready in VoiceStudio on this computer. Finish setting it up in VoiceStudio's Model Catalogue, or choose another engine.`;
  }
  if (needsLicence(engine)) {
    return `${names([engine])} needs its licence accepted in VoiceStudio's Model Catalogue before Reelcraft can use it.`;
  }
  return undefined;
}

const titled = (id: string) =>
  id
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const format = (value: AudioFamily, label: string): SpeechFormat => ({
  value,
  label,
  group: label,
});

const LANGUAGE: SpeechSetting = {
  kind: 'text',
  key: 'language',
  label: 'Language',
  description:
    'The language code of the text, such as en, es or hi. Leave it empty and the engine works it out.',
  placeholder: 'e.g. en',
  maxLength: 20,
};

const SPEED: SpeechSetting = {
  kind: 'slider',
  key: 'speed',
  label: 'Speed',
  min: 0.5,
  max: 2,
  step: 0.05,
  default: 1,
  lowLabel: 'Slower',
  highLabel: 'Faster',
};

const DELIVERY: SpeechSetting = {
  kind: 'text',
  key: 'instructions',
  label: 'Delivery',
  description: 'How to say it, in words: "calm and warm", "excited, a little fast".',
  placeholder: 'e.g. calm, warm and unhurried',
  maxLength: 1000,
};

const WORD_TIMINGS: SpeechSetting = {
  kind: 'switch',
  key: 'wordTimings',
  label: 'Word timings',
  description:
    'Also gets when each word is spoken, for captions: VoiceStudio transcribes the speech after making it, for free. Save it with a Memory write whose path is "timing", and a later stage can read it.',
  default: false,
};

const SEED: SpeechSetting = {
  kind: 'integer',
  key: 'seed',
  label: 'Seed',
  description: 'The same seed, text and settings make the same take again.',
  min: 0,
  placeholder: 'Random',
  advanced: true,
};

/** What the speech editor shows for one VoiceStudio engine. It runs on the user's computer, so the price is zero. */
export function voiceStudioOptions(engine: VoiceStudioEngine): SpeechModelOptions {
  const clones = engine.supports_cloning !== false;
  const presets = engine.preset_voices ?? [];
  const defaultVoice = engine.default_voice ?? (presets.length ? presets[0]! : undefined);
  return {
    summary: clones
      ? 'Runs in VoiceStudio on your own computer. Free, nothing leaves it, and it can speak in voices you cloned or designed in VoiceStudio.'
      : 'Runs in VoiceStudio on your own computer. Free, and nothing leaves it.',
    badges: ['Runs locally', 'Free', ...(clones ? ['Your own voices'] : [])],
    languages: 'Depends on the engine',
    maxChars: VOICESTUDIO_MAX_CHARS,
    audioTags: (engine.expression_caps?.tags?.length ?? 0) > 0,
    pricePerKCharsUsd: 0,
    voices: 'library',
    // Built-in voices belong to one engine.
    voicesByModel: true,
    defaultVoice: defaultVoice
      ? { id: defaultVoice, name: titled(defaultVoice) }
      : { id: DEFAULT_VOICE_ID, name: 'Engine default' },
    formats: [
      format('wav', 'WAV'),
      format('mp3', 'MP3'),
      format('flac', 'FLAC'),
      format('opus', 'Opus'),
    ],
    defaultFormat: 'wav',
    settings: [
      LANGUAGE,
      SPEED,
      ...(engine.instruct_vocabulary === 'freeform' ? [DELIVERY] : []),
      WORD_TIMINGS,
      SEED,
    ],
  };
}

export function engineModelInfo(engine: VoiceStudioEngine): ModelInfo {
  return {
    modelId: engine.id,
    label: engine.display_name || titled(engine.id),
    modalities: ['audio'],
    capabilities: {
      supportsSeed: true,
      supportsIdempotency: false,
      speech: voiceStudioOptions(engine),
    },
  };
}

/** Analyze Media's transcription, with the engine active in VoiceStudio. */
export const TRANSCRIBE_MODEL: ModelInfo = {
  modelId: TRANSCRIBE_MODEL_ID,
  label: 'VoiceStudio transcription',
  modalities: ['media'],
  capabilities: { supportsSeed: false, supportsIdempotency: true },
};

/**
 * The voices one engine can speak in: the user's saved VoiceStudio voices when the engine can
 * clone, then its built-in voices.
 */
export function engineVoices(
  engine: VoiceStudioEngine,
  profiles: VoiceStudioProfile[],
): VoiceInfo[] {
  const saved: VoiceInfo[] =
    engine.supports_cloning === false
      ? []
      : profiles
          .filter((p) => p.type === 'profile')
          .map((p) => ({
            id: p.voice_id,
            name: p.name,
            category: 'cloned',
            description: 'Saved in VoiceStudio',
            ...(p.language && p.language !== 'Auto' && { languages: [p.language] }),
          }));
  const builtIn: VoiceInfo[] = (engine.preset_voices ?? []).map((id) => ({
    id,
    name: titled(id),
    category: 'premade',
  }));
  return [...saved, ...builtIn];
}

/** The JSON body of one `POST /v1/audio/speech`. A setting left unset is not sent. */
export function voiceStudioRequestBody(args: {
  engineId: string;
  voiceId: string;
  text: string;
  format: AudioFamily;
  params: SpeechParams;
}): Record<string, unknown> {
  const { params } = args;
  const speed = numberParam(params, 'speed');
  const seed = numberParam(params, 'seed');
  return {
    model: args.engineId,
    input: args.text,
    voice: args.voiceId,
    response_format: args.format,
    ...(speed !== undefined && speed !== 1 && { speed }),
    ...(seed !== undefined && { seed }),
    ...(textParam(params, 'language') && { language: textParam(params, 'language') }),
    ...(textParam(params, 'instructions') && { instructions: textParam(params, 'instructions') }),
  };
}

/** VoiceStudio's `verbose_json` transcription (OpenAI's shape). */
export interface VerboseTranscription {
  text?: string;
  language?: string;
  duration?: number;
  words?: Array<{ word: string; start: number; end: number }> | null;
}

/** A transcription as Reelcraft's word timings, the same shape Analyze Media writes. */
export function timingFromTranscription(body: VerboseTranscription): TimingMap {
  const words = (body.words ?? [])
    .map((word) => ({ text: word.word.trim(), startSec: word.start, endSec: word.end }))
    .filter((word) => word.text);
  return {
    transcript: (body.text ?? '').trim(),
    ...(body.language && { language: body.language }),
    durationSec: body.duration || words.at(-1)?.endSec || 0,
    sentences: sentencesFromWords(words),
    words,
  };
}
