import type { AttemptOutcome } from '@reefcraft/shared';

/**
 * §3.8.1 — outcomes that consume a semantic retry (count against
 * `retryLimit`), as opposed to a "free" retry (`qc_error`/`infra_error`,
 * which don't). Every outcome phase 2 can actually produce
 * (`check_failed`/`qc_failed`/`provider_error`/`provider_timeout`) belongs
 * here, so `stage_attempt.attemptNo` itself already equals the count of
 * semantic attempts used — no separate counting query is needed today.
 *
 * `infra_error` is deliberately absent: it's a durable-compute-job outcome
 * (phase 4/5) that phase 2's engine loop never produces. Named and exported
 * now so that when it becomes reachable, whatever reads `attemptNo` as a
 * proxy for "attempts used" has one obvious place to fix instead of an
 * implicit assumption nobody remembers to revisit.
 */
export const CONSUMES_SEMANTIC_ATTEMPT: ReadonlySet<AttemptOutcome> = new Set([
  'check_failed',
  'qc_failed',
  'provider_error',
  'provider_timeout',
]);
