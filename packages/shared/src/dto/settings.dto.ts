import { z } from 'zod';
import { Modality } from '../primitives';

/** Providers whose API key can be entered on the Settings page. */
/** `voicestudio` is VoiceStudio's optional API key: needed only when it was started with one and
 * Reelcraft reaches it from another computer or from Docker. */
export const ProviderKeyId = z.enum(['openrouter', 'fal', 'elevenlabs', 'deepgram', 'voicestudio']);
export type ProviderKeyId = z.infer<typeof ProviderKeyId>;

/** Where a provider key comes from. The container environment wins over a
 * key saved in Settings. */
export const ProviderKeySource = z.enum(['env', 'saved']);
export type ProviderKeySource = z.infer<typeof ProviderKeySource>;

/** A provider key's state. Key values never leave the API; `hint` holds
 * only the last four characters. */
export const ProviderKeyStatusDto = z.object({
  id: ProviderKeyId,
  label: z.string(),
  envVar: z.string(),
  configured: z.boolean(),
  source: ProviderKeySource.nullable(),
  hint: z.string().nullable(),
  /** A key is saved but can't be decrypted (the encryption secret changed). */
  unreadable: z.boolean(),
  /** The provider has a connection test. */
  testable: z.boolean(),
});
export type ProviderKeyStatusDto = z.infer<typeof ProviderKeyStatusDto>;

export const BrowserOsSource = z.enum(['saved', 'env', 'default']);
export type BrowserOsSource = z.infer<typeof BrowserOsSource>;

export const BrowserOsSettingsDto = z.object({
  url: z.string(),
  source: BrowserOsSource,
});
export type BrowserOsSettingsDto = z.infer<typeof BrowserOsSettingsDto>;

export const QwenTtsSource = z.enum(['saved', 'env', 'default']);
export type QwenTtsSource = z.infer<typeof QwenTtsSource>;

/** The local Qwen3-TTS service. */
export const QwenTtsSettingsDto = z.object({
  url: z.string(),
  source: QwenTtsSource,
});
export type QwenTtsSettingsDto = z.infer<typeof QwenTtsSettingsDto>;

export const VoiceStudioSource = z.enum(['saved', 'env', 'default']);
export type VoiceStudioSource = z.infer<typeof VoiceStudioSource>;

/** VoiceStudio, the voice app the user installs separately: where its local API is. */
export const VoiceStudioSettingsDto = z.object({
  url: z.string(),
  source: VoiceStudioSource,
});
export type VoiceStudioSettingsDto = z.infer<typeof VoiceStudioSettingsDto>;

export const SettingsDto = z.object({
  keys: z.array(ProviderKeyStatusDto),
  browserOs: BrowserOsSettingsDto,
  qwenTts: QwenTtsSettingsDto,
  voiceStudio: VoiceStudioSettingsDto,
});
export type SettingsDto = z.infer<typeof SettingsDto>;

export const SaveProviderKeyDto = z.object({
  value: z
    .string()
    .trim()
    .min(8, 'That key looks too short')
    .max(1000)
    .refine((v) => !/\s/.test(v), 'Keys contain no spaces'),
});
export type SaveProviderKeyDto = z.infer<typeof SaveProviderKeyDto>;

/** An empty `url` resets the address to the default. */
export const SaveBrowserOsDto = z.object({
  url: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === '' || isHttpUrl(v), 'Enter an http:// or https:// address'),
});
export type SaveBrowserOsDto = z.infer<typeof SaveBrowserOsDto>;

export const TestBrowserOsDto = z.object({
  url: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === '' || isHttpUrl(v), 'Enter an http:// or https:// address')
    .optional(),
});
export type TestBrowserOsDto = z.infer<typeof TestBrowserOsDto>;

/** An empty `url` removes the saved address. */
export const SaveQwenTtsDto = SaveBrowserOsDto;
export type SaveQwenTtsDto = SaveBrowserOsDto;
export const TestQwenTtsDto = TestBrowserOsDto;
export type TestQwenTtsDto = TestBrowserOsDto;

/** An empty `url` removes the saved address. */
export const SaveVoiceStudioDto = SaveBrowserOsDto;
export type SaveVoiceStudioDto = SaveBrowserOsDto;
export const TestVoiceStudioDto = TestBrowserOsDto;
export type TestVoiceStudioDto = TestBrowserOsDto;

export const ConnectionTestDto = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  /** The key works, but something Reelcraft uses with it will not (a missing permission). */
  warning: z.string().optional(),
});
export type ConnectionTestDto = z.infer<typeof ConnectionTestDto>;

/** Steps of "Connect Codex". */
export const CodexLoginPhase = z.enum([
  'starting',
  'opening-neo',
  'waiting-for-approval',
  'connected',
  'failed',
  'cancelled',
]);
export type CodexLoginPhase = z.infer<typeof CodexLoginPhase>;

/** How far Reelcraft got entering the code in BrowserOS Neo. */
export const CodexNeoStep = z.enum(['pending', 'entered', 'needs-sign-in', 'failed', 'skipped']);
export type CodexNeoStep = z.infer<typeof CodexNeoStep>;

export const CodexLoginDto = z.object({
  phase: CodexLoginPhase,
  /** OpenAI's device sign-in page and the one-time code to enter there. */
  url: z.string().nullable(),
  code: z.string().nullable(),
  neo: CodexNeoStep,
  neoMessage: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.string(),
  expiresAt: z.string(),
});
export type CodexLoginDto = z.infer<typeof CodexLoginDto>;

/** Whether Codex can reach BrowserOS Neo through its MCP config:
 * `reelcraft` added the entry, `user` means the user configured it. */
export const CodexNeoRegistration = z.enum(['reelcraft', 'user', 'missing', 'unknown']);
export type CodexNeoRegistration = z.infer<typeof CodexNeoRegistration>;

export const CodexStatusDto = z.object({
  /** The `codex` CLI is installed where the API runs. */
  installed: z.boolean(),
  connected: z.boolean(),
  /** `codex login status` text, such as "Logged in using ChatGPT". */
  detail: z.string().nullable(),
  modalities: z.array(Modality),
  unavailable: z.record(z.string()),
  neoRegistration: CodexNeoRegistration,
  login: CodexLoginDto.nullable(),
});
export type CodexStatusDto = z.infer<typeof CodexStatusDto>;

/** "Connect Claude": the `claude` CLI's sign-in link, and how far it got. There
 * is no one-time code to show: the sign-in page hands back an authorization
 * code that Reelcraft reads from the Neo tab, or the user pastes. */
export const ClaudeLoginDto = CodexLoginDto.omit({ code: true });
export type ClaudeLoginDto = z.infer<typeof ClaudeLoginDto>;

/** The authorization code shown after approving the sign-in, pasted by hand. */
export const ClaudeLoginCodeDto = z.object({ code: z.string().trim().min(1).max(4096) });
export type ClaudeLoginCodeDto = z.infer<typeof ClaudeLoginCodeDto>;

export const ClaudeStatusDto = z.object({
  /** The `claude` CLI is installed where the API runs. */
  installed: z.boolean(),
  connected: z.boolean(),
  /** Such as "Signed in with Claude (pro)". */
  detail: z.string().nullable(),
  modalities: z.array(Modality),
  unavailable: z.record(z.string()),
  login: ClaudeLoginDto.nullable(),
});
export type ClaudeStatusDto = z.infer<typeof ClaudeStatusDto>;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
