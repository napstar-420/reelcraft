import { describe, expect, it } from 'vitest';
import { worstOutcome } from './stage-execute.fn';

describe('worstOutcome', () => {
  it('is nothing when every item of the batch passed', () => {
    expect(worstOutcome([{ outcome: 'passed' }, { outcome: 'passed' }], false)).toBeUndefined();
    expect(worstOutcome([], false)).toBeUndefined();
  });

  it('puts a failure ahead of anything else, whichever item it came from', () => {
    const results = [
      { outcome: 'approval_required', n: 0 },
      { outcome: 'budget_blocked', n: 1 },
      { outcome: 'failed', n: 2 },
      { outcome: 'deferred', n: 3 },
    ];
    expect(worstOutcome(results, false)).toMatchObject({ outcome: 'failed', n: 2 });
    expect(worstOutcome(results.slice(0, 2), false)).toMatchObject({ outcome: 'budget_blocked' });
  });

  it('takes the first of the worst kind, in item order', () => {
    const results = [
      { outcome: 'failed', n: 4 },
      { outcome: 'failed', n: 5 },
    ];
    expect(worstOutcome(results, false)).toMatchObject({ n: 4 });
  });

  it('does not stop for an item held for the end-of-stage review', () => {
    const held = [{ outcome: 'approval_required' }, { outcome: 'passed' }];
    expect(worstOutcome(held, true)).toBeUndefined();
    expect(worstOutcome(held, false)).toMatchObject({ outcome: 'approval_required' });
    expect(worstOutcome([...held, { outcome: 'failed' }], true)).toMatchObject({
      outcome: 'failed',
    });
  });
});
