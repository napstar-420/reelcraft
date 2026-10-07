import type {
  PronunciationDictionaryRef,
  TimingMap,
  SpeechFormat,
  SpeechModelOptions,
  SpeechSetting,
  VoiceInfo,
} from '@reelcraft/shared';
import type { AudioFamily } from '../speech/speech-audio';
import { boolParam, numberParam, textParam, type SpeechParams } from '../speech/speech-params';

/** USD per 1,000 characters on the ElevenLabs API at a cost multiplier of 1.
 * A list price: the bill depends on the plan, so a stage can override it. */
const BASE_PRICE_PER_K_CHARS_USD = 0.1;

const mp3 = (rate: number, kbps: number, note?: string): SpeechFormat => ({
  value: `mp3_${rate}_${kbps}`,
  label: `${rate / 1000} kHz · ${kbps} kbps`,
  group: 'MP3',
  ...(note && { note }),
});
const wav = (rate: number, note?: string): SpeechFormat => ({
  value: `wav_${rate}`,
  label: `${rate / 1000} kHz`,
  group: 'WAV',
  ...(note && { note }),
});
const opus = (kbps: number): SpeechFormat => ({
  value: `opus_48000_${kbps}`,
  label: `48 kHz · ${kbps} kbps`,
  group: 'Opus',
});

/** Raw PCM, μ-law and A-law have no container Reelcraft can play back, so they are left out. */
export const ELEVENLABS_FORMATS: SpeechFormat[] = [
  mp3(44100, 128),
  mp3(44100, 192, 'Creator plan or above'),
  mp3(44100, 96),
  mp3(44100, 64),
  mp3(44100, 32),
  mp3(24000, 48),
  mp3(22050, 32),
  wav(24000),
  wav(44100, 'Pro plan or above'),
  wav(48000),
  wav(32000),
  wav(22050),
  wav(16000),
  wav(8000),
  opus(128),
  opus(192),
  opus(96),
  opus(64),
  opus(32),
];
export const ELEVENLABS_DEFAULT_FORMAT = 'mp3_44100_128';

export function elevenLabsFormatFamily(format: string): AudioFamily {
  const codec = format.split('_')[0];
  return codec === 'wav' ? 'wav' : codec === 'opus' ? 'opus' : 'mp3';
}

/** What a model supports. Verified against ElevenLabs' model docs; the live
 * model list refreshes the limits, languages and price on top of it. */
export interface ElevenLabsModelSpec {
  name: string;
  summary: string;
  badges: string[];
  languages: string;
  maxChars: number;
  audioTags: boolean;
  costMultiplier: number;
  /** A slider of 0 to 1, or the Creative / Natural / Robust presets. */
  stability: 'slider' | 'presets';
  similarity: boolean;
  style: boolean;
  speakerBoost: boolean;
  speed: boolean;
  /** Passes the neighbouring text between the pieces of a long text so they join up. */
  stitching: boolean;
  /** Languages `language_code` can force; none when the model takes no such code. */
  languageCodes?: { code: string; name: string }[];
}

const FLASH_LANGUAGES = [
  ['en', 'English'],
  ['ja', 'Japanese'],
  ['zh', 'Chinese'],
  ['de', 'German'],
  ['hi', 'Hindi'],
  ['fr', 'French'],
  ['ko', 'Korean'],
  ['pt', 'Portuguese'],
  ['it', 'Italian'],
  ['es', 'Spanish'],
  ['id', 'Indonesian'],
  ['nl', 'Dutch'],
  ['tr', 'Turkish'],
  ['fil', 'Filipino'],
  ['pl', 'Polish'],
  ['sv', 'Swedish'],
  ['bg', 'Bulgarian'],
  ['ro', 'Romanian'],
  ['ar', 'Arabic'],
  ['cs', 'Czech'],
  ['el', 'Greek'],
  ['fi', 'Finnish'],
  ['hr', 'Croatian'],
  ['ms', 'Malay'],
  ['sk', 'Slovak'],
  ['da', 'Danish'],
  ['ta', 'Tamil'],
  ['uk', 'Ukrainian'],
  ['ru', 'Russian'],
  ['hu', 'Hungarian'],
  ['no', 'Norwegian'],
  ['vi', 'Vietnamese'],
].map(([code, name]) => ({ code: code!, name: name! }));

const FLASH_V2_5: ElevenLabsModelSpec = {
  name: 'Eleven Flash v2.5',
  summary: 'Our ultra low latency model in 32 languages. Ideal for conversational use cases.',
  badges: ['50% cheaper', 'Low latency'],
  languages: '32 languages',
  maxChars: 40_000,
  audioTags: false,
  costMultiplier: 0.5,
  stability: 'slider',
  similarity: true,
  style: false,
  speakerBoost: true,
  speed: true,
  stitching: true,
  languageCodes: FLASH_LANGUAGES,
};

/** In the order the ElevenLabs model picker lists them. */
export const ELEVENLABS_MODELS: Record<string, ElevenLabsModelSpec> = {
  eleven_v4: {
    name: 'Eleven v4',
    summary: 'Our most emotive, highest quality model. Supports audio tags and 90+ languages.',
    badges: ['Most expressive'],
    languages: '90+ languages',
    maxChars: 10_000,
    audioTags: true,
    costMultiplier: 1,
    stability: 'slider',
    similarity: true,
    style: false,
    speakerBoost: false,
    speed: false,
    stitching: false,
  },
  eleven_v4_turbo: {
    name: 'Eleven v4 Turbo',
    summary: 'The same emotive delivery, optimised for low latency. Supports 90+ languages.',
    badges: ['50% cheaper', 'Low latency'],
    languages: '90+ languages',
    maxChars: 5000,
    audioTags: true,
    costMultiplier: 0.5,
    stability: 'slider',
    similarity: true,
    style: false,
    speakerBoost: false,
    speed: false,
    stitching: false,
  },
  eleven_v3: {
    name: 'Eleven v3',
    summary:
      'Highly expressive, with 70+ languages. Needs more prompt engineering than earlier models.',
    badges: [],
    languages: '70+ languages',
    maxChars: 5000,
    audioTags: true,
    costMultiplier: 1,
    stability: 'presets',
    similarity: false,
    style: false,
    speakerBoost: false,
    speed: false,
    stitching: false,
  },
  eleven_v3_conversational: {
    name: 'Eleven v3 Conversational',
    summary: 'Expressive and real-time, with audio tags and 70+ languages.',
    badges: ['Low latency'],
    languages: '70+ languages',
    maxChars: 5000,
    audioTags: true,
    costMultiplier: 1,
    stability: 'presets',
    similarity: false,
    style: false,
    speakerBoost: false,
    speed: false,
    stitching: false,
  },
  eleven_multilingual_v2: {
    name: 'Eleven Multilingual v2',
    summary:
      'Lifelike, emotionally rich speech in 29 languages. Best for voice-overs and audiobooks.',
    badges: ['Studio quality'],
    languages: '29 languages',
    maxChars: 10_000,
    audioTags: false,
    costMultiplier: 1,
    stability: 'slider',
    similarity: true,
    style: true,
    speakerBoost: true,
    speed: true,
    stitching: true,
  },
  eleven_flash_v2_5: FLASH_V2_5,
  eleven_turbo_v2_5: {
    ...FLASH_V2_5,
    name: 'Eleven Turbo v2.5',
    summary: 'The first low-latency model. Flash v2.5 replaces it.',
    badges: ['50% cheaper', 'Legacy'],
  },
  eleven_flash_v2: {
    ...FLASH_V2_5,
    name: 'Eleven Flash v2',
    summary: 'Ultra low latency, English only.',
    languages: 'English',
    maxChars: 30_000,
    badges: ['50% cheaper', 'Low latency'],
    languageCodes: [{ code: 'en', name: 'English' }],
  },
  eleven_turbo_v2: {
    ...FLASH_V2_5,
    name: 'Eleven Turbo v2',
    summary: 'The first English-only low-latency model. Flash v2 replaces it.',
    languages: 'English',
    maxChars: 30_000,
    badges: ['50% cheaper', 'Legacy'],
    languageCodes: [{ code: 'en', name: 'English' }],
  },
};

/** The part of `GET /v1/models` Generate Speech reads. */
export interface LiveElevenLabsModel {
  model_id: string;
  name: string;
  description?: string;
  can_do_text_to_speech?: boolean;
  can_use_style?: boolean;
  can_use_speaker_boost?: boolean;
  maximum_text_length_per_request?: number;
  languages?: { language_id: string; name: string }[];
  model_rates?: { character_cost_multiplier?: number };
}

const slider = (
  s: Pick<Extract<SpeechSetting, { kind: 'slider' }>, 'key' | 'label' | 'description'> &
    Partial<Extract<SpeechSetting, { kind: 'slider' }>>,
): SpeechSetting => ({ kind: 'slider', min: 0, max: 1, step: 0.05, default: 0, ...s });

function settingsFor(spec: ElevenLabsModelSpec): SpeechSetting[] {
  const settings: SpeechSetting[] = [];
  settings.push(
    spec.stability === 'presets'
      ? {
          kind: 'choice',
          key: 'stability',
          label: 'Stability',
          description:
            'How consistent the delivery is. Creative is the most expressive and the least predictable; Robust stays closest to the voice.',
          default: 0.5,
          options: [
            { value: 0, label: 'Creative' },
            { value: 0.5, label: 'Natural' },
            { value: 1, label: 'Robust' },
          ],
        }
      : slider({
          key: 'stability',
          label: 'Stability',
          description:
            'Lower values give a broader emotional range. Higher values are more consistent but can sound monotonous.',
          default: 0.5,
          lowLabel: 'Creative',
          highLabel: 'Robust',
        }),
  );
  if (spec.similarity) {
    settings.push(
      slider({
        key: 'similarityBoost',
        label: 'Similarity',
        description:
          'How closely the speech sticks to the original voice. Very high values can reproduce noise in the original recording.',
        default: 0.75,
        lowLabel: 'Low',
        highLabel: 'High',
      }),
    );
  }
  if (spec.style) {
    settings.push(
      slider({
        key: 'style',
        label: 'Style exaggeration',
        description:
          "Amplifies the original speaker's style. Anything above 0 uses more compute and adds latency.",
        default: 0,
        lowLabel: 'None',
        highLabel: 'Exaggerated',
      }),
    );
  }
  if (spec.speed) {
    settings.push(
      slider({
        key: 'speed',
        label: 'Speed',
        description: 'How fast the voice speaks. Extreme values can lower the quality.',
        min: 0.7,
        max: 1.2,
        default: 1,
        lowLabel: 'Slower',
        highLabel: 'Faster',
      }),
    );
  }
  if (spec.speakerBoost) {
    settings.push({
      kind: 'switch',
      key: 'speakerBoost',
      label: 'Speaker boost',
      description:
        'Boosts the similarity to the original speaker. Needs slightly more compute, so it adds latency.',
      default: true,
    });
  }
  if (spec.languageCodes?.length) {
    settings.push({
      kind: 'choice',
      key: 'languageCode',
      label: 'Language',
      description:
        'Forces the model and its text normalisation to this language. Leave it unset to detect the language from the text.',
      options: spec.languageCodes.map((l) => ({ value: l.code, label: l.name })),
    });
  }
  settings.push(
    {
      kind: 'switch',
      key: 'wordTimings',
      label: 'Word timings',
      description:
        'Also gets when each word is spoken, for captions. Save it with a Memory write whose path is "timing", and a later stage can read it. It needs no transcription.',
      default: false,
    },
    {
      kind: 'dictionaries',
      key: 'pronunciationDictionaries',
      label: 'Pronunciation dictionaries',
      description:
        'Dictionaries from your ElevenLabs account that fix how names and acronyms are read. Applied in order.',
      max: 3,
    },
    {
      kind: 'integer',
      key: 'seed',
      label: 'Seed',
      description:
        'The same seed and settings give nearly the same speech again. ElevenLabs makes a best effort, so it is not guaranteed.',
      min: 0,
      max: 4_294_967_295,
      placeholder: 'Random',
      advanced: true,
    },
    {
      kind: 'choice',
      key: 'textNormalization',
      label: 'Text normalisation',
      description:
        'Whether numbers, dates and symbols are spelled out. Auto lets ElevenLabs decide. Turning it on for the v2.5 models needs an Enterprise plan.',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'on', label: 'On' },
        { value: 'off', label: 'Off' },
      ],
      advanced: true,
    },
    {
      kind: 'switch',
      key: 'languageTextNormalization',
      label: 'Language text normalisation',
      description:
        'Helps with pronunciation in some languages, but can slow the request a lot. ElevenLabs supports it for Japanese only.',
      default: false,
      advanced: true,
    },
    {
      kind: 'switch',
      key: 'usePvcAsIvc',
      label: 'Use the instant clone of a professional voice',
      description:
        'Uses the instant voice clone version of a professional voice clone. It can be more expressive and faster.',
      default: false,
      advanced: true,
    },
    {
      kind: 'switch',
      key: 'enableLogging',
      label: 'Request logging',
      description:
        'Turn off for zero retention mode, which ElevenLabs offers on Enterprise plans only. Your history and request stitching are then unavailable.',
      default: true,
      advanced: true,
    },
  );
  return settings;
}

export function elevenLabsOptions(spec: ElevenLabsModelSpec): SpeechModelOptions {
  return {
    summary: spec.summary,
    badges: spec.badges,
    languages: spec.languages,
    maxChars: spec.maxChars,
    audioTags: spec.audioTags,
    pricePerKCharsUsd: Number((BASE_PRICE_PER_K_CHARS_USD * spec.costMultiplier).toFixed(4)),
    voices: 'library',
    formats: ELEVENLABS_FORMATS,
    defaultFormat: ELEVENLABS_DEFAULT_FORMAT,
    settings: settingsFor(spec),
  };
}

/** The spec of a model ElevenLabs lists, from what is known about it plus what the live list says. */
export function specFromLive(live: LiveElevenLabsModel): ElevenLabsModelSpec {
  const known = ELEVENLABS_MODELS[live.model_id];
  const languages = live.languages?.length
    ? live.languages.map((l) => ({ code: l.language_id, name: l.name }))
    : undefined;
  const maxChars = live.maximum_text_length_per_request;
  const costMultiplier = live.model_rates?.character_cost_multiplier;
  if (known) {
    return {
      ...known,
      // The live list's own code names, so the setting always sends one ElevenLabs accepts.
      ...(known.languageCodes && languages && { languageCodes: languages }),
      ...(maxChars && maxChars > 0 && maxChars < 1_000_000 && { maxChars }),
      ...(costMultiplier && costMultiplier > 0 && { costMultiplier }),
    };
  }
  return {
    name: live.name,
    summary: live.description?.trim() || 'A speech model from ElevenLabs.',
    badges:
      costMultiplier && costMultiplier < 1
        ? [`${Math.round((1 - costMultiplier) * 100)}% cheaper`]
        : [],
    languages: languages
      ? `${languages.length} ${languages.length === 1 ? 'language' : 'languages'}`
      : 'Multiple languages',
    maxChars: maxChars && maxChars > 0 && maxChars < 1_000_000 ? maxChars : 5000,
    audioTags: false,
    costMultiplier: costMultiplier && costMultiplier > 0 ? costMultiplier : 1,
    stability: 'slider',
    similarity: true,
    style: live.can_use_style === true,
    speakerBoost: live.can_use_speaker_boost === true,
    speed: true,
    stitching: false,
    ...(languages && { languageCodes: languages }),
  };
}

/** The pieces of a text-to-speech request for one piece of text. */
export function elevenLabsRequest(args: {
  voiceId: string;
  modelId: string;
  text: string;
  params: SpeechParams;
  format: string;
  previousText?: string | undefined;
  nextText?: string | undefined;
  /** Ask for the audio together with when each character is spoken. */
  withTimestamps?: boolean;
}): { url: string; body: Record<string, unknown> } {
  const { params } = args;
  const query = new URLSearchParams({ output_format: args.format });
  if (boolParam(params, 'enableLogging') === false) query.set('enable_logging', 'false');

  const stability = numberParam(params, 'stability');
  const similarity = numberParam(params, 'similarityBoost');
  const style = numberParam(params, 'style');
  const speed = numberParam(params, 'speed');
  const boost = boolParam(params, 'speakerBoost');
  const touched = [stability, similarity, style, speed, boost].some((v) => v !== undefined);

  const dictionaries = Array.isArray(params.pronunciationDictionaries)
    ? (params.pronunciationDictionaries as PronunciationDictionaryRef[])
    : [];
  const seed = numberParam(params, 'seed');
  const language = textParam(params, 'languageCode');
  const normalization = textParam(params, 'textNormalization');

  const body: Record<string, unknown> = {
    text: args.text,
    model_id: args.modelId,
    ...(language && { language_code: language }),
    // Sent whole once any is set; left out so the voice keeps its own saved settings otherwise.
    ...(touched && {
      voice_settings: {
        stability: stability ?? 0.5,
        similarity_boost: similarity ?? 0.75,
        style: style ?? 0,
        speed: speed ?? 1,
        use_speaker_boost: boost ?? true,
      },
    }),
    ...(dictionaries.length && {
      pronunciation_dictionary_locators: dictionaries.slice(0, 3).map((d) => ({
        pronunciation_dictionary_id: d.id,
        ...(d.versionId && { version_id: d.versionId }),
      })),
    }),
    ...(seed !== undefined && { seed }),
    ...(args.previousText && { previous_text: args.previousText }),
    ...(args.nextText && { next_text: args.nextText }),
    ...(normalization && { apply_text_normalization: normalization }),
    ...(boolParam(params, 'languageTextNormalization') && {
      apply_language_text_normalization: true,
    }),
    ...(boolParam(params, 'usePvcAsIvc') && { use_pvc_as_ivc: true }),
  };
  return {
    url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(args.voiceId)}${args.withTimestamps ? '/with-timestamps' : ''}?${query}`,
    body,
  };
}

/** A voice as the editor lists it, from `GET /v2/voices`. */
export function toVoiceInfo(voice: {
  voice_id: string;
  name: string;
  description?: string | null;
  category?: string;
  preview_url?: string | null;
  labels?: Record<string, string>;
  verified_languages?: { language?: string }[] | null;
}): VoiceInfo {
  const labels = voice.labels ?? {};
  const languages = [
    ...new Set(
      [labels.language, ...(voice.verified_languages ?? []).map((l) => l.language)].filter(
        (l): l is string => !!l,
      ),
    ),
  ];
  return {
    id: voice.voice_id,
    name: voice.name,
    ...(voice.description && { description: voice.description }),
    ...(labels.gender && { gender: labels.gender }),
    ...(labels.age && { age: labels.age }),
    ...(labels.accent && { accent: labels.accent }),
    ...(languages.length && { languages }),
    ...((labels.use_case ?? labels.usecase) && { useCases: [labels.use_case ?? labels.usecase!] }),
    ...(voice.category && { category: voice.category }),
    ...(voice.preview_url && { previewUrl: voice.preview_url }),
  };
}

/** ElevenLabs' `alignment`: one entry per character of the text. */
export interface CharacterAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

const SENTENCE_END = /[.!?…。！？]["”’')\]]*$/;
/** A delivery tag such as `[whispers]`, which the model acts on instead of speaking. */
const TAG = /^\[[^\]]*\]$/;

/** The words of one piece of speech and when each is spoken, shifted by `offsetSec`. */
export function wordsFromAlignment(
  alignment: CharacterAlignment,
  offsetSec = 0,
): TimingMap['words'] {
  const words: TimingMap['words'] = [];
  let text = '';
  let start = 0;
  let end = 0;
  const flush = () => {
    if (text && !TAG.test(text)) {
      words.push({ text, startSec: round(start + offsetSec), endSec: round(end + offsetSec) });
    }
    text = '';
  };
  alignment.characters.forEach((char, i) => {
    if (/\s/.test(char)) return flush();
    if (!text) start = alignment.character_start_times_seconds[i] ?? end;
    text += char;
    end = alignment.character_end_times_seconds[i] ?? end;
  });
  flush();
  return words;
}

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;

/** The timing map of a whole text, from the alignment of each piece it was spoken in. */
export function timingFromPieces(
  pieces: { text: string; alignment: CharacterAlignment }[],
): TimingMap {
  let offset = 0;
  const words: TimingMap['words'] = [];
  for (const piece of pieces) {
    words.push(...wordsFromAlignment(piece.alignment, offset));
    offset += Math.max(0, ...piece.alignment.character_end_times_seconds);
  }
  const sentences: TimingMap['sentences'] = [];
  let run: TimingMap['words'] = [];
  const close = () => {
    if (!run.length) return;
    sentences.push({
      text: run.map((w) => w.text).join(' '),
      startSec: run[0]!.startSec,
      endSec: run.at(-1)!.endSec,
    });
    run = [];
  };
  for (const word of words) {
    run.push(word);
    if (SENTENCE_END.test(word.text)) close();
  }
  close();
  return {
    transcript: pieces.map((p) => p.text).join(' '),
    durationSec: round(Math.max(offset, words.at(-1)?.endSec ?? 0)),
    sentences,
    words,
  };
}
