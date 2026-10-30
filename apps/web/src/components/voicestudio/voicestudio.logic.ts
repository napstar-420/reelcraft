import type { VoiceStudioSettingsDto, VoiceStudioStatusDto } from '@reelcraft/shared';

export const VOICESTUDIO_STATUS_KEY = ['voicestudio-status'] as const;

/** VoiceStudio can make speech now: it answered, finished starting and accepts Reelcraft's requests. */
export function voiceStudioReady(status: VoiceStudioStatusDto | undefined): boolean {
  return !!status && status.reachable && !status.starting && !status.error;
}

export type StatusTone = 'ok' | 'warn' | 'error' | 'muted';

/** One line on where VoiceStudio stands, for the Settings card and the speech editor. */
export function describeVoiceStudio(status: VoiceStudioStatusDto | undefined): {
  text: string;
  tone: StatusTone;
} {
  if (!status) return { text: 'Checking VoiceStudio…', tone: 'muted' };
  if (status.starting) return { text: 'VoiceStudio is starting…', tone: 'warn' };
  if (status.reachable && status.error) return { text: status.error, tone: 'error' };
  if (!status.reachable) {
    return { text: status.error ?? `VoiceStudio isn't reachable at ${status.url}.`, tone: 'error' };
  }
  const details = [
    status.version && `version ${status.version}`,
    status.device && `runs on ${status.device}`,
  ]
    .filter(Boolean)
    .join(', ');
  return { text: `Connected to VoiceStudio${details ? ` (${details})` : ''}.`, tone: 'ok' };
}

/**
 * The address to open VoiceStudio's own window at, from this browser. Reelcraft in Docker reaches
 * the computer running Docker as `host.docker.internal`, which a browser on that computer knows as
 * `localhost`.
 */
export function voiceStudioBrowserUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    if (parsed.hostname === 'host.docker.internal') parsed.hostname = 'localhost';
    return parsed.toString().replace(/\/v1\/?$/, '/');
  } catch {
    return url;
  }
}

export function voiceStudioSourceLabel(settings: VoiceStudioSettingsDto): string {
  switch (settings.source) {
    case 'saved':
      return 'Saved in Settings';
    case 'env':
      return 'From the container environment (VOICESTUDIO_URL)';
    default:
      return 'VoiceStudio’s default address';
  }
}

/** A voice name from a library file's name: no extension, no separators. */
export function voiceNameFrom(assetName: string): string {
  const base = assetName
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return (base || assetName).slice(0, 80);
}

/** The largest library file a voice can be cloned from; the API refuses bigger ones
 * (`MAX_CLONE_BYTES` in `voicestudio.adapter.ts`). */
export const MAX_CLONE_BYTES = 50_000_000;
