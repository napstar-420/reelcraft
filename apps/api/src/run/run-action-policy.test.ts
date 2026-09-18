import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { RunActionPolicy } from './run-action-policy';

describe('RunActionPolicy', () => {
  const policy = new RunActionPolicy();

  it('owns the action matrix for approval, input, resume, and cancellation', () => {
    expect(policy.isAllowed('PAUSED_APPROVAL', 'approve')).toBe(true);
    expect(policy.isAllowed('PAUSED_INPUT', 'submit_input')).toBe(true);
    expect(policy.isAllowed('FAILED', 'resume')).toBe(true);
    expect(policy.isAllowed('PAUSED_APPROVAL', 'resume')).toBe(false);
    expect(policy.isAllowed('CANCELLED', 'cancel')).toBe(false);
  });

  it('throws a structured conflict for a disallowed action', () => {
    try {
      policy.assertAllowed('COMPLETED', 'patch_overrides');
      throw new Error('expected assertAllowed to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toEqual({
        message: 'Action patch_overrides is not allowed while run is COMPLETED',
        state: 'COMPLETED',
        action: 'patch_overrides',
        allowedStates: ['PAUSED_BUDGET', 'PAUSED_APPROVAL', 'PAUSED_INPUT', 'FAILED'],
      });
    }
  });

  it('allows a caller to narrow, but never widen, an action policy', () => {
    expect(policy.isAllowed('FAILED', 'resume', ['PAUSED_BUDGET'])).toBe(false);
    expect(policy.isAllowed('CREATED', 'resume', ['CREATED'])).toBe(false);
  });
});
