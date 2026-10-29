import { Inject, Injectable } from '@nestjs/common';
import type { VoiceStudioStatusDto } from '@reelcraft/shared';
import { SettingsService } from '../../settings/settings.service';
import { SettingsKeyProvider } from '../key-provider';

const HEALTH_TIMEOUT_MS = 3_000;

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

/** The reason in VoiceStudio's error body: OpenAI's `{ error: { message } }` on `/v1`, FastAPI's `{ detail }` elsewhere. */
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
   * A request to VoiceStudio. Throws `unreachableMessage` when nothing answers, and a
   * `VoiceStudioError` with VoiceStudio's own reason when it answers with an error.
   */
  async request(
    path: string,
    init: { method?: string; body?: BodyInit; json?: unknown; timeoutMs: number },
    url?: string,
  ): Promise<Response> {
    const base = url ? voiceStudioBaseUrl(url) : await this.baseUrl();
    const headers: Record<string, string> = { ...(await this.auth()) };
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
        response.status === 401 ? REFUSED : voiceStudioErrorReason(await response.text());
      throw new VoiceStudioError(response.status, reason);
    }
    return response;
  }

  async json<T>(path: string, timeoutMs: number, url?: string): Promise<T> {
    return (await (await this.request(path, { timeoutMs }, url)).json()) as T;
  }

  /**
   * Whether VoiceStudio answers at `url` (else the saved address) and accepts Reelcraft's
   * requests: it can be used when it is reachable, not starting, and has no `error`. Starts
   * nothing; quick enough for the UI to ask often.
   */
  async status(url?: string): Promise<VoiceStudioStatusDto> {
    const base = url ? voiceStudioBaseUrl(url) : await this.baseUrl();
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
    // `/health` needs no key; this checks the key too, when VoiceStudio asks for one.
    try {
      await this.request('/v1/audio/voices', { timeoutMs: HEALTH_TIMEOUT_MS }, base);
    } catch (error) {
      if (error instanceof VoiceStudioError && error.status === 401) {
        return { ...found, error: REFUSED };
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
