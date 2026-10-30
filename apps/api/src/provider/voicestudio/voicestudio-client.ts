import { Inject, Injectable } from '@nestjs/common';
import type { VoiceStudioStatusDto } from '@reelcraft/shared';
import { SettingsService } from '../../settings/settings.service';
import { SettingsKeyProvider } from '../key-provider';

const HEALTH_TIMEOUT_MS = 3_000;
/** How long a status of the configured address is reused, so validating a blueprint with many
 * VoiceStudio stages asks once rather than once per stage. */
const STATUS_TTL_MS = 2_000;

/** VoiceStudio answered, but not with success. `status` is its HTTP status. */
export class VoiceStudioError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** VoiceStudio's address with any trailing slash or `/v1` removed. */
export const voiceStudioBaseUrl = (url: string): string =>
  url.trim().replace(/\/+$/, '').replace(/\/v1$/, '');

/** Extracts a VoiceStudio error message, or returns the first 200 characters of the body. */
export function voiceStudioErrorReason(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; detail?: unknown };
    if (parsed.error?.message) return parsed.error.message;
    if (typeof parsed.detail === 'string') return parsed.detail;
    const message = (parsed.detail as { message?: unknown } | undefined)?.message;
    if (typeof message === 'string') return message;
  } catch {
    // not JSON
  }
  return body.slice(0, 200);
}

/** What to tell the user when VoiceStudio can't be reached at `base`. */
export const unreachableMessage = (base: string): string =>
  `VoiceStudio isn't reachable at ${base}. Start VoiceStudio, or check its address in Settings → VoiceStudio.`;

const NEEDS_KEY =
  'VoiceStudio at this address asks for an API key. Save the address first, then enter its key in Settings → VoiceStudio.';

const REFUSED =
  'VoiceStudio refused the request: it was started with an API key. Enter the same key in Settings → VoiceStudio.';

/**
 * Talks to VoiceStudio's local API, which the user installs and runs themselves. The address
 * comes from Settings (then `VOICESTUDIO_URL`, then the default), and the API key, when one is
 * set, goes with every request as a bearer token. Both are read on every call, so a change in
 * Settings applies at once.
 */
@Injectable()
export class VoiceStudioClient {
  constructor(
    @Inject(SettingsService)
    private readonly settings: Pick<SettingsService, 'voiceStudio' | 'voiceStudioUrl'>,
    @Inject(SettingsKeyProvider) private readonly keys: Pick<SettingsKeyProvider, 'resolve'>,
  ) {}

  async baseUrl(): Promise<string> {
    return voiceStudioBaseUrl(await this.settings.voiceStudioUrl());
  }

  /**
   * Requests `path` at `url` or the configured address, using `timeoutMs` in milliseconds.
   * The API key is sent only when the normalized address matches the configured address.
   * Network failures and timeouts throw errors; non-success responses throw `VoiceStudioError`,
   * with a specific key message for 401 responses. Settings and response-reading errors propagate.
   */
  async request(
    path: string,
    init: { method?: string; body?: BodyInit; json?: unknown; timeoutMs: number },
    url?: string,
  ): Promise<Response> {
    const configured = await this.baseUrl();
    const base = url ? voiceStudioBaseUrl(url) : configured;
    const headers: Record<string, string> = base === configured ? await this.auth() : {};
    if (init.json !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.json !== undefined ? JSON.stringify(init.json) : (init.body ?? null),
        signal: AbortSignal.timeout(init.timeoutMs),
      });
    } catch (error) {
      const timedOut = (error as Error).name === 'TimeoutError';
      throw new Error(
        timedOut
          ? `VoiceStudio didn't answer within ${Math.round(init.timeoutMs / 1000)} seconds.`
          : unreachableMessage(base),
      );
    }
    if (!response.ok) {
      const reason =
        response.status === 401
          ? base === configured
            ? REFUSED
            : NEEDS_KEY
          : voiceStudioErrorReason(await response.text());
      throw new VoiceStudioError(response.status, reason);
    }
    return response;
  }

  async json<T>(path: string, timeoutMs: number, url?: string): Promise<T> {
    return (await (await this.request(path, { timeoutMs }, url)).json()) as T;
  }

  /**
   * Checks `url` or the configured address. Configured-address results are cached for two seconds;
   * a nonempty `url` is checked afresh. Network failures become an unreachable status, and a
   * 401 from the voice endpoint becomes a status error. Other voice endpoint errors are ignored.
   * Settings errors can propagate.
   */
  async status(url?: string): Promise<VoiceStudioStatusDto> {
    // An address being tried out is always asked afresh; the configured one is reused briefly.
    if (url) return this.check(voiceStudioBaseUrl(url));
    const base = await this.baseUrl();
    const cached = this.recent;
    if (cached && cached.base === base && cached.until > Date.now()) return cached.status;
    const status = this.check(base);
    this.recent = { base, until: Date.now() + STATUS_TTL_MS, status };
    status.catch(() => {
      if (this.recent?.status === status) this.recent = undefined;
    });
    return status;
  }

  private recent:
    { base: string; until: number; status: Promise<VoiceStudioStatusDto> } | undefined;

  private async check(base: string): Promise<VoiceStudioStatusDto> {
    const down = (error: string): VoiceStudioStatusDto => ({
      url: base,
      reachable: false,
      starting: false,
      version: null,
      device: null,
      error,
    });
    let response: Response;
    try {
      response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    } catch {
      return down(unreachableMessage(base));
    }
    const body = (await response.json().catch(() => ({}))) as {
      status?: string;
      device?: string | null;
      version?: string | null;
    };
    if (response.status === 503 && body.status === 'starting') {
      return {
        ...down('VoiceStudio is still starting. Try again in a moment.'),
        reachable: true,
        starting: true,
        version: body.version ?? null,
      };
    }
    if (!response.ok || body.status !== 'ok') {
      return down(
        `Something answered at ${base}, but it isn't VoiceStudio (it answered ${response.status}).`,
      );
    }
    const found = {
      url: base,
      reachable: true,
      starting: false,
      version: body.version ?? null,
      device: body.device ?? null,
    };
    // `/health` needs no key; this checks the key too, when VoiceStudio asks for one. The key
    // goes only to the configured address (see `request`).
    try {
      await this.request('/v1/audio/voices', { timeoutMs: HEALTH_TIMEOUT_MS }, base);
    } catch (error) {
      if (error instanceof VoiceStudioError && error.status === 401) {
        return { ...found, error: error.message };
      }
    }
    return { ...found, error: null };
  }

  /** The user set VoiceStudio up: saved or set its address, or its API key. Left at the default
   * address with no key, a VoiceStudio that doesn't answer is probably not installed. */
  async configured(): Promise<boolean> {
    const { source } = await this.settings.voiceStudio();
    if (source !== 'default') return true;
    return Boolean((await this.keys.resolve('voicestudio')).value);
  }

  private async auth(): Promise<Record<string, string>> {
    const { value } = await this.keys.resolve('voicestudio');
    return value ? { Authorization: `Bearer ${value}` } : {};
  }
}
