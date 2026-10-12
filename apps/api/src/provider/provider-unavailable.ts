/**
 * Starts the message of a failure to reach what drives a browser provider (the
 * BrowserOS Neo browser): a network drop or Neo being down. The attempt loop
 * recognises it by message, because an error that crosses an Inngest step
 * boundary arrives as a plain error without its class.
 */
export const PROVIDER_UNAVAILABLE_PREFIX = 'BrowserOS Neo is unavailable';

export function isProviderUnavailable(err: unknown): boolean {
  return (err instanceof Error ? err.message : String(err)).includes(PROVIDER_UNAVAILABLE_PREFIX);
}
