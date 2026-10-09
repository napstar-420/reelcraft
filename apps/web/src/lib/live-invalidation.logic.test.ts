import { describe, expect, it, vi } from 'vitest';
import { createInvalidationBatcher, queryKeysFor } from './live-invalidation.logic';

describe('queryKeysFor', () => {
  it('invalidates the run and the runs list for a run update', () => {
    expect(queryKeysFor({ type: 'run', runId: 'r1' })).toEqual([['run', 'r1'], ['runs']]);
  });

  it('adds the stage queries for a stage update', () => {
    const keys = queryKeysFor({ type: 'stage', runId: 'r1', stageKey: 'script' });
    expect(keys).toContainEqual(['run', 'r1']);
    expect(keys).toContainEqual(['stage-output', 'r1', 'script']);
    expect(keys).toContainEqual(['stage-attempts', 'r1', 'script']);
    expect(keys).toContainEqual(['stage-logs', 'r1', 'script']);
    expect(keys).toContainEqual(['approval-candidate', 'r1', 'script']);
  });

  it('never touches the per-stage log fan-out query', () => {
    const names = queryKeysFor({ type: 'stage', runId: 'r1', stageKey: 's' }).map((k) => k[0]);
    expect(names).not.toContain('run-reused-stages');
  });
});

describe('createInvalidationBatcher', () => {
  function harness() {
    const invalidate = vi.fn();
    let scheduled: (() => void) | undefined;
    const schedule = vi.fn((fn: () => void) => {
      scheduled = fn;
      return 1;
    });
    const cancel = vi.fn();
    const batcher = createInvalidationBatcher(invalidate, 250, schedule, cancel);
    return { batcher, invalidate, schedule, cancel, fire: () => scheduled?.() };
  }

  it('flushes each distinct key once per window', () => {
    const { batcher, invalidate, schedule, fire } = harness();
    batcher.add([['run', 'r1'], ['runs']]);
    batcher.add([
      ['run', 'r1'],
      ['stage-logs', 'r1', 's'],
    ]);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
    fire();
    expect(invalidate.mock.calls.map(([key]) => key)).toEqual([
      ['run', 'r1'],
      ['runs'],
      ['stage-logs', 'r1', 's'],
    ]);
  });

  it('is throttled: a later key does not postpone the pending flush', () => {
    const { batcher, schedule } = harness();
    batcher.add([['a']]);
    batcher.add([['b']]);
    batcher.add([['c']]);
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it('starts a new window after a flush', () => {
    const { batcher, schedule, fire } = harness();
    batcher.add([['a']]);
    fire();
    batcher.add([['a']]);
    expect(schedule).toHaveBeenCalledTimes(2);
  });

  it('drops pending keys on dispose', () => {
    const { batcher, invalidate, cancel, fire } = harness();
    batcher.add([['a']]);
    batcher.dispose();
    expect(cancel).toHaveBeenCalled();
    fire();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
