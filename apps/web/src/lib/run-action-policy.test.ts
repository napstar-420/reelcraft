import { describe, expect, it } from 'vitest';
import { isRunActionAllowed, RUN_ACTION_ALLOWED_STATES } from './run-action-policy';

/** Mirrors `apps/api/src/run/run-action-policy.ts`'s `RUN_ACTION_ALLOWED_STATES`
 * for the actions this UI cares about. This test is the drift detector: if
 * someone changes one table without the other, this fails. */
const API_ALLOWED_STATES = {
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
  submit_input: ['PAUSED_INPUT'],
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
} as const;

describe('run-action-policy (web) matches the API matrix', () => {
  it.each(Object.keys(API_ALLOWED_STATES) as Array<keyof typeof API_ALLOWED_STATES>)(
    '%s allows exactly the same states as the API',
    (action) => {
      expect([...RUN_ACTION_ALLOWED_STATES[action]].sort()).toEqual(
        [...API_ALLOWED_STATES[action]].sort(),
      );
    },
  );
});

describe('isRunActionAllowed', () => {
  it('allows cancel while running', () => {
    expect(isRunActionAllowed('cancel', 'RUNNING')).toBe(true);
  });

  it('disallows cancel once completed', () => {
    expect(isRunActionAllowed('cancel', 'COMPLETED')).toBe(false);
  });

  it('allows resume from PAUSED_BUDGET/PAUSED_MANUAL/FAILED', () => {
    expect(isRunActionAllowed('resume', 'PAUSED_BUDGET')).toBe(true);
    expect(isRunActionAllowed('resume', 'PAUSED_MANUAL')).toBe(true);
    expect(isRunActionAllowed('resume', 'FAILED')).toBe(true);
    expect(isRunActionAllowed('resume', 'RUNNING')).toBe(false);
  });

  it('allows pause only while RUNNING', () => {
    expect(isRunActionAllowed('pause', 'RUNNING')).toBe(true);
    expect(isRunActionAllowed('pause', 'PAUSED_BUDGET')).toBe(false);
    expect(isRunActionAllowed('pause', 'CREATED')).toBe(false);
  });

  it('allows cancel on a manually paused run', () => {
    expect(isRunActionAllowed('cancel', 'PAUSED_MANUAL')).toBe(true);
  });

  it('allows submit_input only while PAUSED_INPUT', () => {
    expect(isRunActionAllowed('submit_input', 'PAUSED_INPUT')).toBe(true);
    expect(isRunActionAllowed('submit_input', 'PAUSED_APPROVAL')).toBe(false);
  });
});
