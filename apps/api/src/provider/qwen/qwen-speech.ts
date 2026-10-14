import type { SpeechFormat, SpeechModelOptions, SpeechSetting, VoiceInfo } from '@reelcraft/shared';
import type { AudioFamily } from '../speech/speech-audio';
import { textParam, type SpeechParams } from '../speech/speech-params';

/**
 * The models the Qwen3-TTS service offers, for when it can't be asked. The service
 * keeps the real catalog (revisions, sizes, licence) and answers with it when it runs.
 */
export const QWEN_FALLBACK_MODELS = [
  {
    id: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
    label: 'Qwen3-TTS 0.6B',
    totalBytes: 2_498_383_610,
    license: 'Apache-2.0',
    instructions: true,
  },
  {
    id: 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice',
    label: 'Qwen3-TTS 1.7B',
    totalBytes: 4_520_159_586,
    license: 'Apache-2.0',
    instructions: true,
  },
];

/** The CustomVoice speakers, from the model card. The service lists only their names. */
const SPEAKERS: Array<[string, string, string, string]> = [
  ['vivian', 'female', 'zh', 'Bright, slightly edgy young voice'],
  ['serena', 'female', 'zh', 'Warm, gentle young voice'],
  ['uncle_fu', 'male', 'zh', 'Seasoned, low and mellow'],
  ['dylan', 'male', 'zh', 'Youthful Beijing voice'],
  ['eric', 'male', 'zh', 'Lively Chengdu voice'],
  ['ryan', 'male', 'en', 'Dynamic voice with strong rhythm'],
  ['aiden', 'male', 'en', 'Sunny American voice'],
  ['ono_anna', 'female', 'ja', 'Playful Japanese voice'],
  ['sohee', 'female', 'ko', 'Warm Korean voice'],
];

const titled = (id: string) =>
  id
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const KNOWN_VOICES = new Map<string, VoiceInfo>(
  SPEAKERS.map(([id, gender, language, description]) => [
    id,
    { id, name: titled(id), gender, languages: [language], description, category: 'premade' },
  ]),
);

/** A voice the service listed: what we know about it, or just its name. */
export const qwenVoice = (id: string): VoiceInfo =>
  KNOWN_VOICES.get(id.toLowerCase()) ?? { id, name: titled(id) };

export const QWEN_KNOWN_VOICES: VoiceInfo[] = [...KNOWN_VOICES.values()];
export const QWEN_DEFAULT_VOICE = { id: 'vivian', name: 'Vivian' };

const LANGUAGES = [
  'Chinese',
  'English',
  'Japanese',
  'Korean',
  'German',
  'French',
  'Russian',
  'Portuguese',
  'Spanish',
  'Italian',
];

/** Characters one request takes. Longer scripts are split here and joined again, so a
 * piece stays well inside what the model generates in one go. */
export const QWEN_MAX_CHARS = 500;

const format = (value: AudioFamily, label: string): SpeechFormat => ({
  value,
  label,
  group: label,
});

const LANGUAGE: SpeechSetting = {
  kind: 'choice',
  key: 'language',
  label: 'Language',
  description: 'The language of the text. Auto lets the model decide.',
  options: [{ value: 'Auto', label: 'Auto' }, ...LANGUAGES.map((l) => ({ value: l, label: l }))],
  default: 'Auto',
};

const DELIVERY: SpeechSetting = {
  kind: 'text',
  key: 'instructions',
  label: 'Delivery',
  description: 'How to say it, in words: "calm and warm", "excited, a little fast".',
  placeholder: 'e.g. calm, warm and unhurried',
  maxLength: 500,
};

/** What the editor shows for a Qwen3-TTS model. It runs on your own computer, so the price is zero. */
export function qwenOptions(instructions: boolean): SpeechModelOptions {
  return {
    summary: 'Open-weights speech that runs on your own computer. Free, and nothing leaves it.',
    badges: ['Runs locally', 'Free'],
    languages: '10 languages',
    maxChars: QWEN_MAX_CHARS,
    audioTags: false,
    pricePerKCharsUsd: 0,
    voices: 'library',
    defaultVoice: QWEN_DEFAULT_VOICE,
    formats: [
      format('wav', 'WAV'),
      format('mp3', 'MP3'),
      format('flac', 'FLAC'),
      format('opus', 'Opus'),
    ],
    defaultFormat: 'wav',
    settings: instructions ? [LANGUAGE, DELIVERY] : [LANGUAGE],
  };
}

/** The service's address with any trailing slash or `/v1` removed. */
export const qwenBaseUrl = (url: string): string =>
  url.trim().replace(/\/+$/, '').replace(/\/v1$/, '');

/** The JSON body for one piece of text. A setting left unset is not sent. */
export function qwenRequestBody(args: {
  modelId: string;
  voiceId: string;
  text: string;
  format: AudioFamily;
  params: SpeechParams;
}): Record<string, unknown> {
  const { params } = args;
  return {
    model: args.modelId,
    input: args.text,
    voice: args.voiceId,
    response_format: args.format,
    ...(textParam(params, 'language') && { language: textParam(params, 'language') }),
    ...(textParam(params, 'instructions') && { instructions: textParam(params, 'instructions') }),
  };
}

/** The reason in the service's error body (`{ error: { message } }`, or FastAPI's `{ detail }`). */
export function qwenErrorReason(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; detail?: unknown };
    if (parsed.error?.message) return parsed.error.message;
    if (typeof parsed.detail === 'string') return parsed.detail;
  } catch {
    // not JSON
  }
  return body.slice(0, 200);
}
