import type {
  AttemptOutcome,
  RunState,
  StageExecutionState,
  ValidationIssue,
} from '@reefcraft/shared';

export type StatusTone = 'success' | 'running' | 'warning' | 'error' | 'neutral';

export const toneBadgeClassName: Record<StatusTone, string> = {
  success:
    'border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  running: 'border-transparent bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
  warning:
    'border-transparent bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  error:
    'border-transparent bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive',
  neutral: 'border-transparent bg-muted text-muted-foreground',
};

export const toneDotClassName: Record<StatusTone, string> = {
  success: 'bg-emerald-500',
  running: 'bg-blue-500',
  warning: 'bg-amber-500',
  error: 'bg-destructive',
  neutral: 'bg-muted-foreground',
};

const runStateTones: Record<RunState, StatusTone> = {
  CREATED: 'neutral',
  RUNNING: 'running',
  PAUSED_BUDGET: 'warning',
  PAUSED_APPROVAL: 'warning',
  PAUSED_INPUT: 'warning',
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
};

const attemptOutcomeTones: Record<AttemptOutcome, StatusTone> = {
  success: 'success',
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
