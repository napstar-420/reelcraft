import { describe, expect, it } from 'vitest';
import type { JobStatus } from '@reelcraft/shared';
import { withinProviderDeadline } from './stage-attempt-loop';

describe('withinProviderDeadline', () => {
  it('is false once the job is done', () => {
    const status: JobStatus = { done: true, outcome: 'succeeded' };
    expect(withinProviderDeadline(status)).toBe(false);
  });

  it('is false when the provider never reported a deadline', () => {
    const status: JobStatus = { done: false, phase: 'running' };
    expect(withinProviderDeadline(status)).toBe(false);
  });

  it('is true while the provider-declared deadline is still in the future', () => {
    const status: JobStatus = {
      done: false,
      phase: 'running',
      deadlineMs: Date.now() + 60_000,
    };
    expect(withinProviderDeadline(status)).toBe(true);
  });

  it('is false once the provider-declared deadline has passed', () => {
    const status: JobStatus = {
      done: false,
      phase: 'running',
      deadlineMs: Date.now() - 1,
    };
    expect(withinProviderDeadline(status)).toBe(false);
  });
});
