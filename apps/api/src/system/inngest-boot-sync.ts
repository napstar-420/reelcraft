import type { LoggerService } from '@nestjs/common';

export interface InngestBootSyncOptions {
  /** This app's own Inngest serve endpoint, e.g. http://127.0.0.1:8080/api/inngest. */
  url: string;
  logger: LoggerService;
  fetchImpl?: typeof fetch;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

/** Registers this app's functions with the Inngest server right after boot.
 * A PUT to the serve endpoint makes the SDK sync out-of-band with the URL it
 * was called on, so the registration matches the server's own `--sdk-url`.
 * Without this the server only retries on its own schedule, leaving a window
 * where the API answers but new runs are silently never started. Retries
 * until it succeeds; resolves once the server has accepted the sync. */
export async function syncInngestOnBoot({
  url,
  logger,
  fetchImpl = fetch,
  initialDelayMs = 1_000,
  maxDelayMs = 10_000,
}: InngestBootSyncOptions): Promise<void> {
  let delay = initialDelayMs;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetchImpl(url, { method: 'PUT' });
      if (res.ok) {
        logger.log({ attempt }, 'registered with Inngest');
        return;
      }
      if (attempt === 1 || attempt % 10 === 0) {
        logger.warn(
          { attempt, status: res.status, body: await res.text() },
          'Inngest sync rejected; retrying',
        );
      }
    } catch (err) {
      if (attempt === 1 || attempt % 10 === 0) {
        logger.warn({ attempt, err }, 'Inngest sync failed; retrying');
      }
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, maxDelayMs);
  }
}
