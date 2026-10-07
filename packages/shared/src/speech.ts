import { z } from 'zod';

/**
 * Generate Speech settings, described as data.
 *
 * Each speech model declares the controls it supports (`SpeechModelOptions`)
 * and the editor renders them, so the web app hard-codes no vendor. Values
 * are saved in the stage's model `params` under each setting's `key`;
 * `voiceId` and `outputFormat` are the two keys every speech model shares.
 */

const SettingBase = {
  /** The key under the model pin's `params` this setting is saved as. */
  key: z.string(),
  label: z.string(),
  description: z.string().optional(),
  /** Tucked behind "Advanced" in the editor. */
  advanced: z.boolean().optional(),
};

export const SpeechChoiceValue = z.union([z.string(), z.number()]);
export type SpeechChoiceValue = z.infer<typeof SpeechChoiceValue>;

export const SpeechSetting = z.discriminatedUnion('kind', [
  z.object({
    ...SettingBase,
    kind: z.literal('slider'),
    min: z.number(),
    max: z.number(),
    step: z.number(),
    default: z.number(),
    lowLabel: z.string().optional(),
    highLabel: z.string().optional(),
  }),
  z.object({
    ...SettingBase,
    kind: z.literal('choice'),
    options: z.array(
      z.object({ value: SpeechChoiceValue, label: z.string(), description: z.string().optional() }),
    ),
    /** Used when the setting is left unset. Absent = the provider decides. */
    default: SpeechChoiceValue.optional(),
  }),
  z.object({ ...SettingBase, kind: z.literal('switch'), default: z.boolean() }),
  z.object({
    ...SettingBase,
    kind: z.literal('integer'),
    min: z.number().optional(),
    max: z.number().optional(),
    placeholder: z.string().optional(),
  }),
  z.object({
    ...SettingBase,
    kind: z.literal('text'),
    placeholder: z.string().optional(),
    maxLength: z.number().optional(),
  }),
  /** Word → IPA pairs, saved as `{ word, ipa }[]`. */
  z.object({ ...SettingBase, kind: z.literal('pronunciations'), max: z.number() }),
  /** Pronunciation dictionaries from the provider account, saved as `{ id, versionId?, name? }[]`. */
  z.object({ ...SettingBase, kind: z.literal('dictionaries'), max: z.number() }),
]);
export type SpeechSetting = z.infer<typeof SpeechSetting>;

export const SpeechFormat = z.object({
  value: z.string(),
  label: z.string(),
  /** Codec name the editor groups the formats under (`MP3`, `WAV`…). */
  group: z.string(),
  /** A plan or tier requirement, shown beside the format. */
  note: z.string().optional(),
});
export type SpeechFormat = z.infer<typeof SpeechFormat>;

export const SpeechModelOptions = z.object({
  /** One line on what the model is for. */
  summary: z.string(),
  /** Short facts shown as chips: `Most expressive`, `50% cheaper`… */
  badges: z.array(z.string()).optional(),
  /** `90+ languages`, `English`. */
  languages: z.string(),
  /** The most characters one request takes. Longer text is split. */
  maxChars: z.number(),
  /** The model reads delivery tags such as `[whispers]` in the text. */
  audioTags: z.boolean(),
  /** List price, USD per 1,000 characters, used for cost estimates. */
  pricePerKCharsUsd: z.number(),
  /** `library`: pick a voice from the provider's voice list. */
  voices: z.enum(['library', 'none']),
  /** A voice belongs to one model, so picking another model means picking a voice again. */
  voicesByModel: z.boolean().optional(),
  /** The voice used until one is picked. */
  defaultVoice: z.object({ id: z.string(), name: z.string() }).optional(),
  formats: z.array(SpeechFormat),
  defaultFormat: z.string(),
  settings: z.array(SpeechSetting),
});
export type SpeechModelOptions = z.infer<typeof SpeechModelOptions>;

export const VoiceInfo = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  gender: z.string().optional(),
  age: z.string().optional(),
  accent: z.string().optional(),
  /** Language codes the voice speaks (`en`, `es`…). */
  languages: z.array(z.string()).optional(),
  useCases: z.array(z.string()).optional(),
  /** Where the voice comes from: `premade`, `cloned`, `professional`… */
  category: z.string().optional(),
  /** A short sample the editor can play. */
  previewUrl: z.string().optional(),
});
export type VoiceInfo = z.infer<typeof VoiceInfo>;

/** Backs `GET /providers/:id/voices`. */
export const VoiceListDto = z.object({
  voices: z.array(VoiceInfo),
  /** Pass back as `cursor` for the next page. */
  nextCursor: z.string().optional(),
});
export type VoiceListDto = z.infer<typeof VoiceListDto>;

export const PronunciationEntry = z.object({ word: z.string().min(1), ipa: z.string().min(1) });
export type PronunciationEntry = z.infer<typeof PronunciationEntry>;

export const PronunciationDictionaryRef = z.object({
  id: z.string().min(1),
  versionId: z.string().optional(),
  name: z.string().optional(),
});
export type PronunciationDictionaryRef = z.infer<typeof PronunciationDictionaryRef>;

/** Backs `GET /providers/:id/pronunciation-dictionaries`. */
export const PronunciationDictionaryListDto = z.object({
  dictionaries: z.array(PronunciationDictionaryRef),
});
export type PronunciationDictionaryListDto = z.infer<typeof PronunciationDictionaryListDto>;

/** The query of `GET /providers/:id/voices`. */
export const VoiceQueryDto = z.object({
  modelId: z.string().optional(),
  search: z.string().optional(),
  language: z.string().optional(),
  gender: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type VoiceQueryDto = z.infer<typeof VoiceQueryDto>;

/** The body of `POST /providers/:id/speech-preview`: a short sample, spoken with the settings being edited. */
export const SpeechPreviewRequestDto = z.object({
  modelId: z.string().min(1),
  params: z.record(z.string(), z.unknown()),
  text: z.string().trim().min(1).max(300),
});
export type SpeechPreviewRequestDto = z.infer<typeof SpeechPreviewRequestDto>;

export const SpeechPreviewDto = z.object({
  audioBase64: z.string(),
  mime: z.string(),
  characters: z.number(),
  /** What the sample cost, in USD. */
  costUsd: z.number(),
});
export type SpeechPreviewDto = z.infer<typeof SpeechPreviewDto>;
