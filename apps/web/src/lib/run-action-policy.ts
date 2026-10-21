import type { RunState } from '@reelcraft/shared';

/** Client-side mirror of a subset of `apps/api/src/run/run-action-policy.ts`'s
 * `RUN_ACTION_ALLOWED_STATES` — used only to avoid showing dead-end buttons
 * on `RunPage`/`RunsPage`. The server (`RunActionPolicy.assertAllowed`, via
 * `ConflictException`) is the actual enforcement point; if you change one
 * table, check the other. `PAUSED_MANUAL` is deliberately left out of
 * `retry` (see the server table's comment) — retrying a manually-paused run
 * would silently resume it. */
export const RUN_ACTION_ALLOWED_STATES = {
  pause: ['RUNNING'],
  raise_budget: [
    'RUNNING',
    'PAUSED_BUDGET',
    'PAUSED_APPROVAL',
    'PAUSED_INPUT',
    'PAUSED_MANUAL',
    'PAUSED_QUOTA',
    'FAILED',
  ],
  retry: [
    'PAUSED_BUDGET',
    'PAUSED_APPROVAL',
    'PAUSED_INPUT',
    'PAUSED_QUOTA',
    'FAILED',
    'COMPLETED',
  ],
  submit_input: [
    'PAUSED_APPROVAL',
    'PAUSED_INPUT',
    'FAILED',
    'CANCELLED',
    'IDLE',
    'PAUSED_MANUAL',
    'PAUSED_BUDGET',
    'PAUSED_QUOTA',
  ],
  resume: ['PAUSED_BUDGET', 'PAUSED_MANUAL', 'PAUSED_QUOTA', 'FAILED'],
  cancel: [
    'CREATED',
    'RUNNING',
    'PAUSED_BUDGET',
    'PAUSED_APPROVAL',
    'PAUSED_INPUT',
    'PAUSED_MANUAL',
    'PAUSED_QUOTA',
    'FAILED',
  ],
} as const satisfies Record<string, readonly RunState[]>;

export type RunAction = keyof typeof RUN_ACTION_ALLOWED_STATES;

/** Whether a person can answer an open wait (review, input) in this run state: the
 * run is parked on people, or stopped for another reason with the wait still open.
 * Approve, reject and retry QC share `submit_input`'s states on the server. */
export function canAnswerWaits(state: string): boolean {
  return (RUN_ACTION_ALLOWED_STATES.submit_input as readonly string[]).includes(state);
}

export function isRunActionAllowed(action: RunAction, state: RunState): boolean {
  return (RUN_ACTION_ALLOWED_STATES[action] as readonly RunState[]).includes(state);
}
