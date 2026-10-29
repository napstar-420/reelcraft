import type {
  BlenderSetupDto,
  BlenderSource,
  BrowserOsSettingsDto,
  ClaudeLoginDto,
  CodexLoginDto,
  CodexLoginPhase,
  CodexStatusDto,
  ProviderKeyId,
  ProviderKeyStatusDto,
  QwenTtsSettingsDto,
} from '@reelcraft/shared';

export const SETTINGS_KEY = ['settings'] as const;
export const CODEX_STATUS_KEY = ['codex-status'] as const;
export const CODEX_LOGIN_KEY = ['codex-login'] as const;
export const CLAUDE_STATUS_KEY = ['claude-status'] as const;
export const CLAUDE_LOGIN_KEY = ['claude-login'] as const;

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
  deepgram: {
    use: 'Voice-over, transcription and captions.',
    keyUrl: 'https://console.deepgram.com',
  },
  voicestudio: {
    use: 'Only needed when VoiceStudio was started with an API key (OMNIVOICE_API_KEY) and Reelcraft reaches it from Docker or another computer. Enter the same key here.',
    keyUrl: 'https://github.com/debpalash/VoiceStudio/blob/main/docs/api-auth.md',
  },
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

export function qwenTtsSourceLabel(settings: QwenTtsSettingsDto): string {
  switch (settings.source) {
    case 'saved':
      return 'Saved in Settings';
    case 'env':
      return 'From the container environment (QWEN_TTS_URL)';
    default:
      return 'Not set, so Reelcraft runs the service itself';
  }
}

export function blenderSourceLabel(source: BlenderSource | null): string {
  switch (source) {
    case 'saved':
      return 'Chosen in Settings';
    case 'env':
      return 'From the environment (BLENDER_PATH)';
    case 'managed':
      return 'Downloaded by Reelcraft';
    case 'found':
      return 'Installed on this computer';
    default:
      return 'Not found';
  }
}

/** What Blender renders on: its GPUs, or the CPU, and why when it is likely Docker on a Mac. */
export function blenderRendersWith(
  setup: Pick<BlenderSetupDto, 'devices' | 'inContainer'>,
): string {
  if (setup.devices.length) {
    const names = [...new Set(setup.devices.map((device) => `${device.name} (${device.backend})`))];
    return `Renders on ${names.join(', ')}`;
  }
  return setup.inContainer
    ? 'Renders on the CPU: no GPU is visible in this container. On Linux or Windows with an NVIDIA card, start it with --gpus all; Docker on a Mac cannot use the GPU.'
    : 'Renders on the CPU: no GPU Blender can use was found.';
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function loginActive(login: { phase: CodexLoginPhase } | null | undefined): boolean {
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

/** The instruction to show while "Connect Claude" runs. */
export function claudeLoginStep(login: ClaudeLoginDto): string {
  switch (login.phase) {
    case 'starting':
      return 'Asking Claude for a sign-in link…';
    case 'opening-neo':
      return 'Opening the sign-in page in BrowserOS Neo…';
    case 'waiting-for-approval':
      if (login.neo === 'entered') return 'Finishing the sign-in…';
      if (login.neo === 'pending') {
        return 'In BrowserOS Neo, sign in to Claude and approve the request. Reelcraft picks up the code itself.';
      }
      return 'Open the link below in any browser, approve the request, then paste the code it shows.';
    case 'connected':
      return 'Claude is connected.';
    case 'cancelled':
      return 'Sign-in cancelled.';
    case 'failed':
      return login.error ?? 'Sign-in failed.';
  }
}

/** Shows the link and a box for the code: while waiting, unless Reelcraft already sent it. */
export function showClaudeManualCode(login: ClaudeLoginDto): boolean {
  return login.phase === 'waiting-for-approval' && login.neo !== 'entered' && !!login.url;
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

/** One line per capability of a CLI provider: available, or why not. */
export function capabilityLines(
  status: Pick<CodexStatusDto, 'modalities' | 'unavailable'>,
  modalities: string[],
): Array<{ label: string; ok: boolean; reason?: string }> {
  return modalities.map((modality) => {
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
