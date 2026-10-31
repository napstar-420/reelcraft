import type { RunState } from '@reelcraft/shared';

/** The three groups a run is shown in: it needs a person, it is still going, or it is over. */
export type RunBucket = 'needs-you' | 'active' | 'finished';

/** Waiting on a decision only a person can make: a failure, a review, an input, a budget. */
export const NEEDS_YOU_STATES: RunState[] = [
  'FAILED',
  'PAUSED_APPROVAL',
  'PAUSED_INPUT',
  'PAUSED_BUDGET',
];

/** Still going, or paused in a way that resumes (by itself, or by Continue). */
export const ACTIVE_STATES: RunState[] = [
  'CREATED',
  'RUNNING',
  'PAUSING',
  'CANCELLING',
  'PAUSED_QUOTA',
  'PAUSED_MANUAL',
];

export function runBucket(state: RunState): RunBucket {
  if (NEEDS_YOU_STATES.includes(state)) return 'needs-you';
  if (ACTIVE_STATES.includes(state)) return 'active';
  return 'finished';
}

/** Newest first, by start time. */
export function newestFirst<T extends { startedAt: string }>(runs: T[]): T[] {
  return [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** What a run's state means, in a few words, for a list row. */
export function runStateSentence(state: RunState): string {
  switch (state) {
    case 'FAILED':
      return 'Failed';
    case 'PAUSED_APPROVAL':
      return 'Waiting for your review';
    case 'PAUSED_INPUT':
      return 'Waiting for your input';
    case 'PAUSED_BUDGET':
      return 'Paused at its budget limit';
    case 'PAUSED_QUOTA':
      return 'Paused until the provider allows more';
    case 'PAUSED_MANUAL':
      return 'Paused by you';
    case 'PAUSING':
      return 'Pausing';
    case 'CANCELLING':
      return 'Stopping';
    case 'CREATED':
      return 'Starting';
    case 'RUNNING':
      return 'Running';
    case 'COMPLETED':
      return 'Done';
    case 'CANCELLED':
      return 'Stopped';
    case 'IDLE':
      return 'Idle';
  }
}

/** A short, stable handle for a run: the first 8 characters of its id. */
export function runHandle(id: string): string {
  return `#${id.slice(0, 8)}`;
}
