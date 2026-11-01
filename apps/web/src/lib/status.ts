import type {
  AttemptOutcome,
  RunState,
  StageExecutionState,
  ValidationIssue,
} from '@reelcraft/shared';

export type StatusTone = 'success' | 'running' | 'warning' | 'error' | 'neutral';

export const toneBadgeClassName: Record<StatusTone, string> = {
  success: 'border-transparent bg-ok-soft text-ok',
  running: 'border-transparent bg-run-soft text-run',
  warning: 'border-transparent bg-wait-soft text-wait',
  error: 'border-transparent bg-bad-soft text-bad',
  neutral: 'border-transparent bg-surface-3 text-muted-foreground',
};

export const toneDotClassName: Record<StatusTone, string> = {
  success: 'bg-ok',
  running: 'bg-run',
  warning: 'bg-wait',
  error: 'bg-bad',
  neutral: 'bg-faint',
};

/** Text colour for a tone, for sentences and icons. */
export const toneTextClassName: Record<StatusTone, string> = {
  success: 'text-ok',
  running: 'text-run',
  warning: 'text-wait',
  error: 'text-bad',
  neutral: 'text-muted-foreground',
};

const runStateTones: Record<RunState, StatusTone> = {
  CREATED: 'neutral',
  RUNNING: 'running',
  IDLE: 'neutral',
  PAUSING: 'warning',
  CANCELLING: 'warning',
  PAUSED_BUDGET: 'warning',
  PAUSED_APPROVAL: 'warning',
  PAUSED_INPUT: 'warning',
  PAUSED_MANUAL: 'warning',
  PAUSED_QUOTA: 'warning',
  FAILED: 'error',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
};

const stageExecutionStateTones: Record<StageExecutionState, StatusTone> = {
  pending: 'neutral',
  running: 'running',
  awaiting_approval: 'warning',
  awaiting_input: 'warning',
  passed: 'success',
  failed: 'error',
  stale: 'warning',
  skipped: 'neutral',
  cancelled: 'neutral',
};

const attemptOutcomeTones: Record<AttemptOutcome, StatusTone> = {
  success: 'success',
  awaiting_approval: 'warning',
  check_failed: 'error',
  qc_failed: 'error',
  qc_error: 'error',
  qc_budget_exhausted: 'warning',
  provider_error: 'error',
  provider_timeout: 'warning',
  infra_error: 'error',
  budget_blocked: 'warning',
  rejected: 'error',
  cancelled: 'neutral',
  user_edit: 'neutral',
  deferred: 'warning',
};

const severityTones: Record<ValidationIssue['severity'], StatusTone> = {
  error: 'error',
  warning: 'warning',
};

export function runStateTone(state: RunState): StatusTone {
  return runStateTones[state];
}

export function stageExecutionStateTone(state: StageExecutionState): StatusTone {
  return stageExecutionStateTones[state];
}

export function attemptOutcomeTone(outcome: AttemptOutcome): StatusTone {
  return attemptOutcomeTones[outcome];
}

export function severityTone(severity: ValidationIssue['severity']): StatusTone {
  return severityTones[severity];
}

/** Turns a `SCREAMING_SNAKE` or `snake_case` status value into "Title Case". */
export function formatStatusLabel(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
