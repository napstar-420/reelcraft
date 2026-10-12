/**
 * Starts the message of a failure to reach what drives a browser provider (the
 * BrowserOS Neo browser): a network drop or Neo being down. The attempt loop
 * recognises it by message, because an error that crosses an Inngest step
 * boundary arrives as a plain error without its class.
 */
export const PROVIDER_UNAVAILABLE_PREFIX = 'BrowserOS Neo is unavailable';

/** What Neo reports for a `run` it cut off at its 30 s cap. The tab is still
 * open and a fresh read of it may fit, so it is retried like an unreachable browser. */
const NEO_RUN_TIMEOUT = /BrowserOS Neo script failed: run exceeded \d+ms/;

export function isProviderUnavailable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes(PROVIDER_UNAVAILABLE_PREFIX) || NEO_RUN_TIMEOUT.test(message);
}
