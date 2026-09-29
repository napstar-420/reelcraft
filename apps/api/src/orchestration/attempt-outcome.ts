import type { AttemptOutcome } from '@reelcraft/shared';

/**
 * Outcomes that count against a stage's `retryLimit` — genuine crashes only
 * (the provider errored or timed out, or the attempt threw). Quality
 * rejections are NOT stage failures and never consume it: `check_failed`
 * and `qc_failed` have their own caps (`checkMaxAttempts`/`qc.maxAttempts`),
 * a human `rejected` is uncapped, and `qc_error`/`infra_error`/
 * `budget_blocked` are handled separately by the attempt loop.
 */
export const CONSUMES_RETRY_LIMIT: ReadonlySet<AttemptOutcome> = new Set([
  'provider_error',
  'provider_timeout',
]);
