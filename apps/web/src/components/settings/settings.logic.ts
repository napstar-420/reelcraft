import type {
  BrowserOsSettingsDto,
  CodexLoginDto,
  CodexStatusDto,
  ProviderKeyId,
  ProviderKeyStatusDto,
} from '@reelcraft/shared';

export const SETTINGS_KEY = ['settings'] as const;
export const CODEX_STATUS_KEY = ['codex-status'] as const;
export const CODEX_LOGIN_KEY = ['codex-login'] as const;

/** What each provider is used for, and where to get a key. */
export const PROVIDER_INFO: Record<ProviderKeyId, { use: string; keyUrl: string }> = {
  openrouter: {
    use: 'Text and image models from many vendors, through one key.',
    keyUrl: 'https://openrouter.ai/settings/keys',
  },
  fal: { use: 'Image and video generation.', keyUrl: 'https://fal.ai/dashboard/keys' },
  elevenlabs: {
    use: 'Voice-over (text to speech).',
    keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
  },
  deepgram: { use: 'Transcription and captions.', keyUrl: 'https://console.deepgram.com' },
};

export type Tone = 'ok' | 'muted' | 'warn';

export function keyBadge(key: ProviderKeyStatusDto): { label: string; tone: Tone } {
  if (key.source === 'env') return { label: 'Set by container environment', tone: 'ok' };
  if (key.source === 'saved') return { label: `Saved ${key.hint ?? ''}`.trim(), tone: 'ok' };
  if (key.unreadable) return { label: "Saved key can't be read", tone: 'warn' };
  return { label: 'Not set', tone: 'muted' };
}

export function browserOsSourceLabel(settings: BrowserOsSettingsDto): string {
  switch (settings.source) {
    case 'saved':
      return 'Saved in Settings';
    case 'env':
      return 'From the container environment';
    default:
      return 'Default address';
  }
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function loginActive(login: CodexLoginDto | null | undefined): boolean {
  return (
    login?.phase === 'starting' ||
    login?.phase === 'opening-neo' ||
    login?.phase === 'waiting-for-approval'
  );
}

/** The instruction to show while "Connect Codex" runs. */
export function loginStep(login: CodexLoginDto): string {
  switch (login.phase) {
    case 'starting':
      return 'Asking OpenAI for a sign-in code…';
    case 'opening-neo':
      return 'Opening the sign-in page in BrowserOS Neo…';
    case 'waiting-for-approval':
      if (login.neo === 'entered') {
        return 'In BrowserOS Neo, check the OpenAI page and approve the sign-in.';
      }
      if (login.neo === 'needs-sign-in') {
        return 'In BrowserOS Neo, sign in to your OpenAI account, enter the code below, then approve.';
      }
      return 'Open the link below in any browser, enter the code, then approve the sign-in.';
    case 'connected':
      return 'Codex is connected.';
    case 'cancelled':
      return 'Sign-in cancelled.';
    case 'failed':
      return login.error ?? 'Sign-in failed.';
  }
}

/** Shows the link and code: always unless Neo entered the code itself. */
export function showManualCode(login: CodexLoginDto): boolean {
  return login.phase === 'waiting-for-approval' && login.neo !== 'entered' && !!login.code;
}

const MODALITY_LABELS: Record<string, string> = {
  text: 'Text',
  image: 'Images',
  browser: 'Browser tasks',
};

/** One line per Codex capability: available, or why not. */
export function codexCapabilities(
  status: CodexStatusDto,
): Array<{ label: string; ok: boolean; reason?: string }> {
  return ['text', 'image', 'browser'].map((modality) => {
    const ok = (status.modalities as string[]).includes(modality);
    const reason = status.unavailable[modality];
    return {
      label: MODALITY_LABELS[modality] ?? modality,
      ok,
      ...(!ok && reason ? { reason } : {}),
    };
  });
}

export function neoRegistrationLabel(status: CodexStatusDto): string | null {
  switch (status.neoRegistration) {
    case 'reelcraft':
      return 'BrowserOS Neo is set up for Codex.';
    case 'user':
      return 'Codex uses your own BrowserOS Neo setting.';
    case 'missing':
      return 'BrowserOS Neo is not set up for Codex yet. It is added when you connect Codex or save the Neo address.';
    default:
      return null;
  }
}
