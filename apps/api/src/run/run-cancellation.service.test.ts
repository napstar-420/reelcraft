import { describe, expect, it, vi } from 'vitest';
import { RunCancellationService } from './run-cancellation.service';

describe('RunCancellationService', () => {
  it('marks the run cancelled and resolves waits before emitting cancellation', async () => {
    const set = vi.fn().mockReturnValue({ where: vi.fn() });
    const tx = { update: vi.fn().mockReturnValue({ set }) };
    const waits = { resolveAll: vi.fn() };
    const mutation = {
      withLockedRun: vi.fn(async (_id, _action, _states, callback) => {
        await callback(tx);
        return { wakeupId: 'wake-cancel', revision: 8 };
      }),
    };
    const dispatcher = { dispatch: vi.fn() };
    const service = new RunCancellationService(
      mutation as never,
      dispatcher as never,
      waits as never,
    );

    await service.cancel('run-1');

    expect(set).toHaveBeenCalledWith({ state: 'CANCELLED', endedAt: expect.any(String) });
    expect(waits.resolveAll).toHaveBeenCalledWith(tx, 'run-1');
    expect(dispatcher.dispatch).toHaveBeenCalledWith('wake-cancel');
  });
});
