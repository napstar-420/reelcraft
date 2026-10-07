import { z } from 'zod';
import { Modality } from '../primitives';

/** Providers whose API key can be entered on the Settings page. */
export const ProviderKeyId = z.enum(['openrouter', 'fal', 'elevenlabs', 'deepgram']);
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

export const SettingsDto = z.object({
  keys: z.array(ProviderKeyStatusDto),
  browserOs: BrowserOsSettingsDto,
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

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
