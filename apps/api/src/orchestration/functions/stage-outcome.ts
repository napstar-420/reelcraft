import type { StageAttemptOutcome } from './stage-attempt-loop';

/** What `stage.execute` returns to `run.orchestrate`: an attempt outcome, or
 * `input_required` for a stage that waits on a person. */
export type StageOutcome = StageAttemptOutcome | { outcome: 'input_required' };

/** Worst first. A failure outranks everything; waiting on a person is the
 * mildest reason to stop. An outcome not listed sorts first. */
export const STOP_PRIORITY = [
  'failed',
  'budget_blocked',
  'deferred',
  'run_not_running',
  'approval_required',
  'input_required',
] as const;

/** The outcome that ends a batch of items or stages: the first of the worst
 * kind, in order. Undefined when everything passed. */
export function worstOutcome<T extends { outcome: string }>(results: T[]): T | undefined {
  const stopping = results.filter((result) => result.outcome !== 'passed');
  const rank = (outcome: string): number => (STOP_PRIORITY as readonly string[]).indexOf(outcome);
  return stopping.sort((a, b) => rank(a.outcome) - rank(b.outcome))[0];
}
