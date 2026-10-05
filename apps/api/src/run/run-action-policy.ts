import { ConflictException, Injectable } from '@nestjs/common';
import type { RunState } from '@reelcraft/shared';

export type RunAction =
  | 'attach'
  | 'start'
  | 'pause'
  | 'raise_budget'
  | 'retry'
  | 'edit_artifact'
  | 'replace_input'
  | 'patch_overrides'
  | 'approve'
  | 'reject'
  | 'retry_qc'
  | 'submit_input'
  | 'resume'
  | 'cancel';

/** States the run enters *automatically* (budget exhaustion, an approval or
 * form-input gate). Deliberately excludes `PAUSED_MANUAL` — retry/edit/
 * patch-overrides reading from this array would otherwise silently accept
 * an operator-paused run and implicitly resume it via `run/resumed`,
 * defeating the point of a manual pause. If a future change needs one of
 * those actions to also work from `PAUSED_MANUAL`, add it to that action's
 * entry explicitly rather than to this shared array. */
const PAUSED_STATES = ['PAUSED_BUDGET', 'PAUSED_APPROVAL', 'PAUSED_INPUT', 'PAUSED_QUOTA'] as const;

/** The single source of truth for the Phase 4 run action matrix (§12.4).
 * `apps/web/src/lib/run-action-policy.ts` keeps an intentionally-duplicated
 * client-side mirror of the actions RunPage/RunsPage gate buttons on (UX
 * only, not enforcement) — if you change this table, check that one too. */
export const RUN_ACTION_ALLOWED_STATES = {
  attach: ['CREATED'],
  start: ['CREATED'],
  pause: ['RUNNING'],
  raise_budget: ['RUNNING', ...PAUSED_STATES, 'PAUSED_MANUAL', 'FAILED'],
  retry: [...PAUSED_STATES, 'FAILED', 'COMPLETED'],
  edit_artifact: [...PAUSED_STATES, 'FAILED', 'COMPLETED'],
  replace_input: [...PAUSED_STATES, 'FAILED', 'COMPLETED'],
  patch_overrides: [...PAUSED_STATES, 'FAILED'],
  approve: ['PAUSED_APPROVAL'],
  reject: ['PAUSED_APPROVAL'],
  retry_qc: ['PAUSED_APPROVAL'],
  submit_input: ['PAUSED_INPUT'],
  resume: ['PAUSED_BUDGET', 'PAUSED_MANUAL', 'PAUSED_QUOTA', 'FAILED'],
  cancel: ['CREATED', 'RUNNING', ...PAUSED_STATES, 'PAUSED_MANUAL', 'FAILED'],
} as const satisfies Record<RunAction, readonly RunState[]>;

@Injectable()
export class RunActionPolicy {
  allowedStates(action: RunAction, narrowedTo?: readonly RunState[]): readonly RunState[] {
    const owned = RUN_ACTION_ALLOWED_STATES[action] as readonly RunState[];
    if (!narrowedTo) return owned;
    return owned.filter((state) => narrowedTo.includes(state));
  }

  isAllowed(state: RunState, action: RunAction, narrowedTo?: readonly RunState[]): boolean {
    return this.allowedStates(action, narrowedTo).includes(state);
  }

  assertAllowed(state: RunState, action: RunAction, narrowedTo?: readonly RunState[]): void {
    const allowedStates = this.allowedStates(action, narrowedTo);
    if (allowedStates.includes(state)) return;
    throw new ConflictException({
      message: `Action ${action} is not allowed while run is ${state}`,
      state,
      action,
      allowedStates,
    });
  }
}
