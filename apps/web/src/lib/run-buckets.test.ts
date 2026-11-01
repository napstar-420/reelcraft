import { describe, expect, it } from 'vitest';
import { newestFirst, runBucket, runHandle, runStateSentence } from './run-buckets';

describe('runBucket', () => {
  it('puts failures and every wait for a person under needs-you', () => {
    for (const state of ['FAILED', 'PAUSED_APPROVAL', 'PAUSED_INPUT', 'PAUSED_BUDGET'] as const)
      expect(runBucket(state)).toBe('needs-you');
  });

  it('keeps runs that resume on their own or on Continue active', () => {
    for (const state of ['RUNNING', 'CREATED', 'PAUSED_QUOTA', 'PAUSED_MANUAL', 'PAUSING'] as const)
      expect(runBucket(state)).toBe('active');
  });

  it('treats completed, stopped and idle runs as finished', () => {
    for (const state of ['COMPLETED', 'CANCELLED', 'IDLE'] as const)
      expect(runBucket(state)).toBe('finished');
  });
});

describe('newestFirst', () => {
  it('sorts by start time, newest first, without changing the input', () => {
    const runs = [{ startedAt: '2026-01-01' }, { startedAt: '2026-03-01' }];
    expect(newestFirst(runs).map((r) => r.startedAt)).toEqual(['2026-03-01', '2026-01-01']);
    expect(runs[0]!.startedAt).toBe('2026-01-01');
  });
});

describe('labels', () => {
  it('says what a waiting run waits for', () => {
    expect(runStateSentence('PAUSED_APPROVAL')).toBe('Waiting for your review');
  });

  it('shortens a run id to a handle', () => {
    expect(runHandle('a1b2c3d4e5f6')).toBe('#a1b2c3d4');
  });
});
