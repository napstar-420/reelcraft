import { InngestTestEngine } from '@inngest/test';
import { Inngest } from 'inngest';
import { describe, expect, it, vi } from 'vitest';
import { buildRunWakeupDispatchFunction } from './run-wakeup-dispatch.fn';

describe('run.wakeup-dispatch', () => {
  it('periodically retries undispatched wakeups', async () => {
    const client = new Inngest({ id: 'run-wakeup-dispatch-test' });
    const dispatcher = {
      dispatchPending: vi.fn().mockResolvedValue({ dispatched: 2, failed: 1 }),
    };
    const fn = buildRunWakeupDispatchFunction(client, dispatcher as never);
    const engine = new InngestTestEngine({ function: fn });

    const { result, error } = await engine.execute();

    expect(error).toBeUndefined();
    expect(result).toEqual({ dispatched: 2, failed: 1 });
    expect(dispatcher.dispatchPending).toHaveBeenCalledOnce();
    expect(fn.id()).toBe('run.wakeup-dispatch');
  });
});
