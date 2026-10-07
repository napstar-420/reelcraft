import type {
  ModelInfoDto,
  PartialModelPin,
  SpeechFormat,
  SpeechModelOptions,
  SpeechSetting,
} from '@reelcraft/shared';

/** The params every speech model shares. Each model's own settings are listed in its options. */
const COMMON_KEYS = ['voiceId', 'voiceName', 'outputFormat', 'pricePerCharacterUsd'];

export type SpeechParams = Record<string, unknown>;

export function speechOptionsOf(model: ModelInfoDto | undefined): SpeechModelOptions | undefined {
  return model?.capabilities?.speech;
}

/** `params` with `key` set, or removed when `value` is undefined, so an untouched setting stays unsaved. */
export function withParam(
  params: SpeechParams | undefined,
  key: string,
  value: unknown,
): SpeechParams {
  const next = { ...(params ?? {}) };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

/** A pin with `key` set in its params. */
export function withPinParam(
  pin: PartialModelPin | undefined,
  key: string,
  value: unknown,
): PartialModelPin {
  return { ...pin, params: withParam(pin?.params, key, value) };
}

/** The pin with a voice chosen: its id for the provider, its name for display. */
export function withVoice(
  pin: PartialModelPin | undefined,
  voice: { id: string; name: string } | undefined,
): PartialModelPin {
  return {
    ...pin,
    params: withParam(withParam(pin?.params, 'voiceId', voice?.id), 'voiceName', voice?.name),
  };
}

/** Whether the setting has been moved off the model's own default. */
export const isCustomised = (setting: SpeechSetting, params: SpeechParams | undefined): boolean =>
  params?.[setting.key] !== undefined;

/** How a slider's value reads next to it. */
export function formatSlider(value: number, step: number): string {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return value.toFixed(decimals);
}

/** The formats grouped by codec, in the order the model lists them. */
export function groupFormats(
  formats: SpeechFormat[],
): { group: string; formats: SpeechFormat[] }[] {
  const groups: { group: string; formats: SpeechFormat[] }[] = [];
  for (const format of formats) {
    const existing = groups.find((g) => g.group === format.group);
    if (existing) existing.formats.push(format);
    else groups.push({ group: format.group, formats: [format] });
  }
  return groups;
}

/** The label of a saved format, or of the model's default when none is saved. */
export function formatLabel(options: SpeechModelOptions, value: string | undefined): string {
  const format = options.formats.find((f) => f.value === (value ?? options.defaultFormat));
  return format ? `${format.group} · ${format.label}` : (value ?? options.defaultFormat);
}

/** Keeps the params the new model still has a use for: the shared ones, and any of its own settings. */
export function pruneSpeechParams(
  params: SpeechParams | undefined,
  options: SpeechModelOptions,
): SpeechParams {
  const allowed = new Set([...COMMON_KEYS, ...options.settings.map((s) => s.key)]);
  const next: SpeechParams = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (allowed.has(key)) next[key] = value;
  }
  if (next.outputFormat && !options.formats.some((f) => f.value === next.outputFormat)) {
    delete next.outputFormat;
  }
  return next;
}

/** The pin after the user picks a model: settings the model lacks are dropped, and the voice with them when it was tied to the old model. */
export function nextSpeechPin(
  current: PartialModelPin | undefined,
  model: ModelInfoDto,
): PartialModelPin {
  const options = speechOptionsOf(model);
  const sameModel = current?.modelId === model.modelId;
  let params = options ? pruneSpeechParams(current?.params, options) : (current?.params ?? {});
  if (options?.voicesByModel && !sameModel) {
    params = withParam(withParam(params, 'voiceId', undefined), 'voiceName', undefined);
  }
  return { ...current, provider: model.providerId, modelId: model.modelId, params };
}

/** The pin after the user picks a provider: nothing from another provider's voices or settings carries over. */
export function nextSpeechPinForProvider(provider: string | undefined): PartialModelPin {
  return { provider, modelId: undefined, version: undefined, params: {} };
}

/** What a request costs at the model's list price, or the stage's own price. */
export function estimateSpeechCostUsd(
  characters: number,
  options: SpeechModelOptions,
  params: SpeechParams | undefined,
): number {
  const own = params?.pricePerCharacterUsd;
  const perChar = typeof own === 'number' && own >= 0 ? own : options.pricePerKCharsUsd / 1000;
  return characters * perChar;
}

export const formatUsd = (usd: number): string =>
  usd >= 0.1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(usd >= 0.01 ? 3 : 4)}`;

/** A pin's voice as the stage's summary shows it: `Rachel · eleven_v4`. */
export function speechPinSummary(pin: PartialModelPin | undefined): string {
  if (!pin?.modelId) return pin?.provider ?? 'Inherited';
  const voice = pin.params?.voiceName ?? pin.params?.voiceId;
  return typeof voice === 'string' && voice ? `${voice} · ${pin.modelId}` : pin.modelId;
}
