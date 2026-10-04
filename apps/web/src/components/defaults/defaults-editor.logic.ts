import type { ConfigLayer, Modality, PartialModelPin } from '@reelcraft/shared';

/** The kinds of work a default model can be set for, in the order the
 * editor lists them. Keys match the first part of a capability id. */
export const MODEL_KINDS: { kind: Modality; label: string }[] = [
  { kind: 'text', label: 'Text' },
  { kind: 'image', label: 'Images' },
  { kind: 'video', label: 'Video' },
  { kind: 'audio', label: 'Speech and audio' },
  { kind: 'media', label: 'Media analysis' },
];

export const ASPECT_RATIOS = ['9:16', '16:9', '1:1', '4:5'] as const;

const RESOLUTION = /^\d+x\d+$/;

export function isResolution(value: string): boolean {
  return value === '' || RESOLUTION.test(value);
}

/** A copy of `obj` without `key`. */
export function omitKey<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

function hasKeys(value: object): boolean {
  return Object.keys(value).length > 0;
}

/** A model pin counts once a provider is picked. */
export function setKindModel(
  layer: ConfigLayer,
  kind: Modality,
  pin: PartialModelPin | undefined,
): ConfigLayer {
  const models = { ...layer.models };
  if (pin?.provider) models[kind] = pin;
  else delete models[kind];
  const rest = omitKey(layer, 'models');
  return hasKeys(models) ? { ...rest, models } : rest;
}

export function setRetryLimit(layer: ConfigLayer, retries: number | undefined): ConfigLayer {
  const rest = omitKey(layer, 'retryLimit');
  return retries === undefined ? rest : { ...rest, retryLimit: retries };
}

export function setStageCap(layer: ConfigLayer, capUsd: number | undefined): ConfigLayer {
  const budget = { ...layer.budget };
  if (capUsd === undefined) delete budget.stageCapUsd;
  else budget.stageCapUsd = capUsd;
  const rest = omitKey(layer, 'budget');
  return hasKeys(budget) ? { ...rest, budget } : rest;
}

type Format = NonNullable<ConfigLayer['format']>;

export function setFormat<K extends 'aspectRatio' | 'resolution' | 'fps'>(
  layer: ConfigLayer,
  key: K,
  value: Format[K] | undefined,
): ConfigLayer {
  const format: Format = { ...layer.format };
  if (value === undefined || value === '') delete format[key];
  else format[key] = value;
  const rest = omitKey(layer, 'format');
  return hasKeys(format) ? { ...rest, format } : rest;
}

/** `''` for an empty field, otherwise a whole number of at least `min`. */
export function parseWhole(raw: string, min = 0): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min ? n : undefined;
}

export function parseAmount(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export type InheritedDefaults = {
  retryLimit: number;
  stageCapUsd?: number;
  models: Partial<Record<Modality, PartialModelPin>>;
};

/** What a stage gets when it leaves a field empty: the blueprint's default,
 * else the channel's, else the engine's (0 retries, no cap). */
export function inheritedDefaults(channel: ConfigLayer, blueprint: ConfigLayer): InheritedDefaults {
  const stageCapUsd = blueprint.budget?.stageCapUsd ?? channel.budget?.stageCapUsd ?? undefined;
  const models: Partial<Record<Modality, PartialModelPin>> = { ...channel.models };
  for (const [kind, pin] of Object.entries(blueprint.models ?? {})) {
    if (pin) models[kind as Modality] = pin;
  }
  return {
    retryLimit: blueprint.retryLimit ?? channel.retryLimit ?? 0,
    ...(stageCapUsd !== undefined && { stageCapUsd }),
    models,
  };
}

/** The Google accounts Flow stages may use, in order of use. An empty list
 * clears the setting, so the stage falls back to the channel's. */
export function setFlowAccounts(layer: ConfigLayer, accounts: string[]): ConfigLayer {
  const rest = omitKey(layer, 'flow');
  return accounts.length ? { ...rest, flow: { accounts } } : rest;
}

/** Adds `email` at the end of the list, or removes it when already listed. */
export function toggleAccount(accounts: string[], email: string): string[] {
  return accounts.includes(email) ? accounts.filter((a) => a !== email) : [...accounts, email];
}

export type FlowAccountChoice = { email: string; name: string; signedIn: boolean };

/** Accounts matching a search box (by email or name), case-insensitively. */
export function filterAccounts(accounts: FlowAccountChoice[], query: string): FlowAccountChoice[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return accounts;
  return accounts.filter(
    (a) => a.email.toLowerCase().includes(needle) || a.name.toLowerCase().includes(needle),
  );
}
