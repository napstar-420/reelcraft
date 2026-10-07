import {
  PronunciationDictionaryRef,
  PronunciationEntry,
  type SpeechModelOptions,
  type SpeechSetting,
} from '@reelcraft/shared';

export type SpeechParams = Record<string, unknown>;

export interface SpeechParamIssue {
  /** The `params` key at fault. */
  key: string;
  message: string;
}

/** The parameter is unset, as when the editor clears a field. */
const unset = (value: unknown) => value === undefined || value === null || value === '';

export const textParam = (params: SpeechParams, key: string): string | undefined => {
  const value = params[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

export const numberParam = (params: SpeechParams, key: string): number | undefined => {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

export const boolParam = (params: SpeechParams, key: string): boolean | undefined =>
  typeof params[key] === 'boolean' ? (params[key] as boolean) : undefined;

/** The USD price of one character: the stage's own price if it set one, else the model's list price. */
export function pricePerCharacter(options: SpeechModelOptions, params: SpeechParams): number {
  const own = numberParam(params, 'pricePerCharacterUsd');
  return own !== undefined && own >= 0 ? own : options.pricePerKCharsUsd / 1000;
}

function check(setting: SpeechSetting, value: unknown): string | undefined {
  switch (setting.kind) {
    case 'slider':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a number';
      if (value < setting.min || value > setting.max)
        return `must be between ${setting.min} and ${setting.max}`;
      return undefined;
    case 'choice':
      return setting.options.some((option) => option.value === value)
        ? undefined
        : `must be one of: ${setting.options.map((option) => option.value).join(', ')}`;
    case 'switch':
      return typeof value === 'boolean' ? undefined : 'must be true or false';
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) return 'must be a whole number';
      if (setting.min !== undefined && value < setting.min)
        return `must be at least ${setting.min}`;
      if (setting.max !== undefined && value > setting.max) return `must be at most ${setting.max}`;
      return undefined;
    case 'text':
      if (typeof value !== 'string') return 'must be text';
      return setting.maxLength !== undefined && value.length > setting.maxLength
        ? `must be at most ${setting.maxLength} characters`
        : undefined;
    case 'pronunciations': {
      if (!Array.isArray(value)) return 'must be a list of word and pronunciation pairs';
      if (value.length > setting.max) return `can have at most ${setting.max} entries`;
      return value.every((entry) => PronunciationEntry.safeParse(entry).success)
        ? undefined
        : 'every entry needs a word and its pronunciation';
    }
    case 'dictionaries': {
      if (!Array.isArray(value)) return 'must be a list of pronunciation dictionaries';
      if (value.length > setting.max) return `can have at most ${setting.max} dictionaries`;
      return value.every((entry) => PronunciationDictionaryRef.safeParse(entry).success)
        ? undefined
        : 'every dictionary needs an id';
    }
  }
}

/**
 * Checks a stage's model params against what the model supports. Params the
 * model doesn't declare are ignored, not rejected: a channel default can set
 * a voice setting that one of its models doesn't have.
 */
export function validateSpeechParams(
  options: SpeechModelOptions,
  params: SpeechParams | undefined,
): SpeechParamIssue[] {
  const p = params ?? {};
  const issues: SpeechParamIssue[] = [];
  if (!unset(p.voiceId) && !textParam(p, 'voiceId')) {
    issues.push({ key: 'voiceId', message: 'The voice id must be text.' });
  } else if (unset(p.voiceId) && options.voices === 'library' && !options.defaultVoice) {
    issues.push({ key: 'voiceId', message: 'Choose a voice.' });
  }
  if (!unset(p.outputFormat) && !options.formats.some((f) => f.value === p.outputFormat)) {
    issues.push({
      key: 'outputFormat',
      message: `"${String(p.outputFormat)}" isn't an output format this model offers.`,
    });
  }
  const price = p.pricePerCharacterUsd;
  if (!unset(price) && !(typeof price === 'number' && price >= 0)) {
    issues.push({
      key: 'pricePerCharacterUsd',
      message: 'The price per character must be a number of dollars, zero or more.',
    });
  }
  for (const setting of options.settings) {
    const value = p[setting.key];
    if (unset(value)) continue;
    const problem = check(setting, value);
    if (problem) issues.push({ key: setting.key, message: `${setting.label} ${problem}.` });
  }
  return issues;
}
