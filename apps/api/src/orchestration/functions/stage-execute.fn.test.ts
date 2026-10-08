import { describe, expect, it } from 'vitest';
import { worstOutcome } from './stage-execute.fn';

describe('worstOutcome', () => {
  it('is nothing when every item of the batch passed', () => {
    expect(worstOutcome([{ outcome: 'passed' }, { outcome: 'passed' }])).toBeUndefined();
    expect(worstOutcome([])).toBeUndefined();
  });

  it('puts a failure ahead of anything else, whichever item it came from', () => {
    const results = [
      { outcome: 'approval_required', n: 0 },
      { outcome: 'budget_blocked', n: 1 },
      { outcome: 'failed', n: 2 },
      { outcome: 'deferred', n: 3 },
    ];
    expect(worstOutcome(results)).toMatchObject({ outcome: 'failed', n: 2 });
    expect(worstOutcome(results.slice(0, 2))).toMatchObject({ outcome: 'budget_blocked' });
  });

  it('takes the first of the worst kind, in item order', () => {
    const results = [
      { outcome: 'failed', n: 4 },
      { outcome: 'failed', n: 5 },
    ];
    expect(worstOutcome(results)).toMatchObject({ n: 4 });
  });

  it('treats an item waiting for approval as the mildest reason to stop', () => {
    expect(worstOutcome([{ outcome: 'approval_required' }, { outcome: 'passed' }])).toMatchObject({
      outcome: 'approval_required',
    });
    expect(
      worstOutcome([{ outcome: 'approval_required' }, { outcome: 'run_not_running' }]),
    ).toMatchObject({ outcome: 'run_not_running' });
  });
});
