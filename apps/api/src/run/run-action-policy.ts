import { ConflictException, Injectable } from '@nestjs/common';
import type { RunState } from '@reefcraft/shared';

export type RunAction =
  | 'attach'
  | 'start'
  | 'raise_budget'
  | 'retry'
  | 'edit_artifact'
  | 'replace_input'
  | 'patch_overrides'
  | 'approve'
  | 'reject'
  | 'submit_input'
  | 'resume'
  | 'cancel';

const PAUSED_STATES = ['PAUSED_BUDGET', 'PAUSED_APPROVAL', 'PAUSED_INPUT'] as const;

/** The single source of truth for the Phase 4 run action matrix (§12.4). */
export const RUN_ACTION_ALLOWED_STATES = {
  attach: ['CREATED'],
  start: ['CREATED'],
  raise_budget: ['RUNNING', ...PAUSED_STATES, 'FAILED'],
  retry: [...PAUSED_STATES, 'FAILED', 'COMPLETED'],
  edit_artifact: [...PAUSED_STATES, 'FAILED', 'COMPLETED'],
  replace_input: [...PAUSED_STATES, 'FAILED', 'COMPLETED'],
  patch_overrides: [...PAUSED_STATES, 'FAILED'],
  approve: ['PAUSED_APPROVAL'],
  reject: ['PAUSED_APPROVAL'],
  submit_input: ['PAUSED_INPUT'],
  resume: ['PAUSED_BUDGET', 'FAILED'],
  cancel: ['CREATED', 'RUNNING', ...PAUSED_STATES, 'FAILED'],
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
