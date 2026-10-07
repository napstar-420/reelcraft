import type {
  PronunciationEntry,
  SpeechFormat,
  SpeechModelOptions,
  SpeechSetting,
  VoiceInfo,
} from '@reelcraft/shared';
import type { AudioFamily } from '../speech/speech-audio';
import { boolParam, numberParam, textParam, type SpeechParams } from '../speech/speech-params';
import { AURA_1_VOICES, AURA_2_VOICES, FLUX_VOICES } from './deepgram-voices';

/** Deepgram's three text-to-speech families. The model Reelcraft stores is the family; the
 * voice is stored as `voiceId`, and `<prefix>-<voiceId>` is the model string Deepgram wants. */
export type DeepgramFamily = 'flux' | 'aura-2' | 'aura';

interface FamilySpec {
  label: string;
  summary: string;
  badges: string[];
  languages: string;
  endpoint: string;
  prefix: string;
  /** Characters one request takes. Deepgram documents 2,000 for Aura; Flux is held to the same. */
  maxChars: number;
  pricePerKCharsUsd: number;
  voices: VoiceInfo[];
  defaultVoice: { id: string; name: string };
  formats: SpeechFormat[];
  defaultFormat: string;
  settings: SpeechSetting[];
}

const mp3 = (kbps: number): SpeechFormat => ({
  value: `mp3_${kbps}k`,
  label: `${kbps} kbps`,
  group: 'MP3',
});
const wav = (rate: number): SpeechFormat => ({
  value: `wav_${rate}`,
  label: `${rate / 1000} kHz · 16-bit`,
  group: 'WAV',
});
const flac = (rate: number): SpeechFormat => ({
  value: `flac_${rate}`,
  label: `${rate / 1000} kHz`,
  group: 'FLAC',
});
const opus = (kbps: number): SpeechFormat => ({
  value: `opus_${kbps}k`,
  label: `48 kHz · ${kbps} kbps`,
  group: 'Opus',
});
const aac = (kbps: number): SpeechFormat => ({
  value: `aac_${kbps}k`,
  label: `${kbps} kbps`,
  group: 'AAC',
});

const COMMON_FORMATS = [
  wav(24000),
  wav(16000),
  wav(32000),
  wav(48000),
  wav(8000),
  mp3(48),
  mp3(32),
  flac(48000),
  flac(32000),
  flac(22050),
  flac(16000),
  flac(8000),
  opus(12),
  opus(32),
  opus(64),
  opus(128),
  aac(48),
  aac(96),
  aac(192),
];

/** Flux takes more MP3 bit rates and CD-rate WAV than Aura. */
const FLUX_FORMATS = [
  ...COMMON_FORMATS.slice(0, 5),
  wav(44100),
  mp3(48),
  mp3(40),
  mp3(32),
  mp3(24),
  mp3(16),
  mp3(8),
  ...COMMON_FORMATS.slice(7),
];

const mipOptOut: SpeechSetting = {
  kind: 'switch',
  key: 'mipOptOut',
  label: 'Opt out of model improvement',
  description:
    "Keeps this request out of Deepgram's Model Improvement Program. Opting out can change what Deepgram charges, so check their pricing first.",
  default: false,
  advanced: true,
};
const tag: SpeechSetting = {
  kind: 'text',
  key: 'tag',
  label: 'Usage tag',
  description: 'A label Deepgram shows on this request in its usage reports.',
  placeholder: 'e.g. reelcraft',
  maxLength: 128,
  advanced: true,
};
const pronunciations = (note: string): SpeechSetting => ({
  kind: 'pronunciations',
  key: 'pronunciations',
  label: 'Pronunciations',
  description: `Words to read your way, given in IPA. ${note}`,
  max: 100,
});

export const DEEPGRAM_FAMILIES: Record<DeepgramFamily, FamilySpec> = {
  flux: {
    label: 'Flux TTS',
    summary: 'Deepgram’s newest and best-sounding voices, English only. Expressive by default.',
    badges: ['Newest'],
    languages: 'English',
    endpoint: 'https://api.deepgram.com/v2/speak',
    prefix: 'flux',
    maxChars: 2000,
    pricePerKCharsUsd: 0.045,
    voices: FLUX_VOICES,
    defaultVoice: { id: 'haley-en', name: 'Haley' },
    formats: FLUX_FORMATS,
    defaultFormat: 'wav_24000',
    settings: [
      {
        kind: 'slider',
        key: 'speed',
        label: 'Speed',
        description:
          'How fast the voice speaks. Pauses in the text cap it at 1.15, and pronunciations need it left at 1.',
        min: 0.5,
        max: 1.5,
        step: 0.05,
        default: 1,
        lowLabel: 'Slower',
        highLabel: 'Faster',
      },
      {
        kind: 'slider',
        key: 'expressivity',
        label: 'Expressivity (beta)',
        description:
          'Moves the delivery from calm to animated. 0 is the tuned default and the only value Deepgram has validated for production. Larger values can add or drop words.',
        min: -2,
        max: 2,
        step: 1,
        default: 0,
        lowLabel: 'Calm',
        highLabel: 'Animated',
      },
      pronunciations(
        'Early access on Flux, and it can’t be combined with a speed other than 1 or with pauses.',
      ),
      mipOptOut,
      tag,
    ],
  },
  'aura-2': {
    label: 'Aura-2',
    summary:
      'Deepgram’s widest-language voices: English, Spanish, German, French, Dutch, Italian and Japanese.',
    badges: [],
    languages: '7 languages',
    endpoint: 'https://api.deepgram.com/v1/speak',
    prefix: 'aura-2',
    maxChars: 2000,
    pricePerKCharsUsd: 0.03,
    voices: AURA_2_VOICES,
    defaultVoice: { id: 'thalia-en', name: 'Thalia' },
    formats: COMMON_FORMATS,
    defaultFormat: 'wav_24000',
    settings: [
      {
        kind: 'slider',
        key: 'speed',
        label: 'Speed',
        description:
          'How fast the voice speaks. Works for English and Spanish; Spanish voices sound best from 0.9 up.',
        min: 0.7,
        max: 1.5,
        step: 0.05,
        default: 1,
        lowLabel: 'Slower',
        highLabel: 'Faster',
      },
      pronunciations('Works for English and Spanish.'),
      mipOptOut,
      tag,
    ],
  },
  aura: {
    label: 'Aura',
    summary: 'The first-generation voices. English only and half the price of Aura-2.',
    badges: ['50% cheaper'],
    languages: 'English',
    endpoint: 'https://api.deepgram.com/v1/speak',
    prefix: 'aura',
    maxChars: 2000,
    pricePerKCharsUsd: 0.015,
    voices: AURA_1_VOICES,
    defaultVoice: { id: 'asteria-en', name: 'Asteria' },
    formats: COMMON_FORMATS,
    defaultFormat: 'wav_24000',
    settings: [mipOptOut, tag],
  },
};

export function isDeepgramFamily(id: string): id is DeepgramFamily {
  return Object.hasOwn(DEEPGRAM_FAMILIES, id);
}

export function deepgramOptions(family: DeepgramFamily): SpeechModelOptions {
  const spec = DEEPGRAM_FAMILIES[family];
  return {
    summary: spec.summary,
    badges: spec.badges,
    languages: spec.languages,
    maxChars: spec.maxChars,
    // Deepgram reads tags aloud: only inline pauses and pronunciations are markup it understands.
    audioTags: false,
    pricePerKCharsUsd: spec.pricePerKCharsUsd,
    voices: 'library',
    voicesByModel: true,
    defaultVoice: spec.defaultVoice,
    formats: spec.formats,
    defaultFormat: spec.defaultFormat,
    settings: spec.settings,
  };
}

/** The output settings a format id stands for. */
export function deepgramFormat(id: string): {
  query: Record<string, string>;
  family: AudioFamily;
} {
  const [codec, value = ''] = id.split('_');
  const number = Number.parseInt(value, 10);
  switch (codec) {
    case 'mp3':
      return { query: { encoding: 'mp3', bit_rate: String(number * 1000) }, family: 'mp3' };
    case 'wav':
      return {
        query: { encoding: 'linear16', container: 'wav', sample_rate: String(number) },
        family: 'wav',
      };
    case 'flac':
      return { query: { encoding: 'flac', sample_rate: String(number) }, family: 'flac' };
    case 'opus':
      return {
        query: { encoding: 'opus', container: 'ogg', bit_rate: String(number * 1000) },
        family: 'opus',
      };
    case 'aac':
      return { query: { encoding: 'aac', bit_rate: String(number * 1000) }, family: 'aac' };
    default:
      throw new Error(`Deepgram: unknown output format "${id}"`);
  }
}

/** The settings Deepgram refuses to take together, or a reason a request can't be made as set. */
export function deepgramConflict(family: DeepgramFamily, params: SpeechParams): string | undefined {
  const speed = numberParam(params, 'speed');
  const hasPronunciations =
    Array.isArray(params.pronunciations) && params.pronunciations.length > 0;
  if (family === 'flux' && hasPronunciations && speed !== undefined && speed !== 1) {
    return 'Flux can’t apply pronunciations and a speed other than 1 together. Reset the speed or remove the pronunciations.';
  }
  return undefined;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Wraps each listed word in the inline marker Deepgram reads as "say it like this". */
export function applyPronunciations(text: string, entries: PronunciationEntry[]): string {
  let result = text;
  for (const { word, ipa } of entries) {
    const whole = new RegExp(
      `(?<![\\p{L}\\p{N}_])${escapeRegExp(word.trim())}(?![\\p{L}\\p{N}_])`,
      'giu',
    );
    // The marker's braces are escaped with a backslash; its body is JSON without its own braces.
    result = result.replace(
      whole,
      (match) => `\\{${JSON.stringify({ word: match, pronounce: ipa.trim() }).slice(1, -1)}\\}`,
    );
  }
  return result;
}

/** The voices of a family, narrowed by the editor's search and filters. */
export function filterVoices(
  voices: VoiceInfo[],
  query: {
    search?: string | undefined;
    language?: string | undefined;
    gender?: string | undefined;
  },
): VoiceInfo[] {
  const needle = query.search?.trim().toLowerCase();
  return voices.filter((voice) => {
    if (query.language && !voice.languages?.includes(query.language)) return false;
    if (query.gender && voice.gender !== query.gender) return false;
    if (!needle) return true;
    return [voice.name, voice.accent, voice.description, voice.useCases?.join(' ')]
      .join(' ')
      .toLowerCase()
      .includes(needle);
  });
}

/** One text-to-speech request for one piece of text. */
export function deepgramRequest(args: {
  family: DeepgramFamily;
  voiceId: string;
  text: string;
  params: SpeechParams;
  format: string;
}): { url: string; body: { text: string } } {
  const spec = DEEPGRAM_FAMILIES[args.family];
  const query = new URLSearchParams({
    model: `${spec.prefix}-${args.voiceId}`,
    ...deepgramFormat(args.format).query,
  });
  const speed = numberParam(args.params, 'speed');
  if (speed !== undefined && speed !== 1) query.set('speed', String(speed));
  const expressivity = numberParam(args.params, 'expressivity');
  if (args.family === 'flux' && expressivity) query.set('expressivity', String(expressivity));
  if (boolParam(args.params, 'mipOptOut')) query.set('mip_opt_out', 'true');
  const tag = textParam(args.params, 'tag');
  if (tag) query.set('tag', tag);
  return { url: `${spec.endpoint}?${query}`, body: { text: args.text } };
}
