import { describe, expect, it, vi } from 'vitest';
import { stageExecution } from '../db/schema/index';
import { RunCancellationService } from './run-cancellation.service';
import { RUN_ACTION_ALLOWED_STATES } from './run-action-policy';

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

  it('reads its allowed states from the shared policy table, not a private copy', async () => {
    // Regression guard for the drift this service used to have: a
    // hand-maintained `CANCELLABLE_STATES` that didn't import
    // `RUN_ACTION_ALLOWED_STATES.cancel` and so could silently diverge from
    // it (e.g. rejecting cancel on `PAUSED_MANUAL` even after the policy
    // table itself was updated to allow it).
    const mutation = {
      withLockedRun: vi.fn(async () => ({ wakeupId: 'wake-cancel', revision: 8 })),
    };
    const waits = { resolveAll: vi.fn() };
    const dispatcher = { dispatch: vi.fn() };
    const service = new RunCancellationService(
      mutation as never,
      dispatcher as never,
      waits as never,
    );

    await service.cancel('run-1');

    expect(mutation.withLockedRun).toHaveBeenCalledWith(
      'run-1',
      'cancel',
      RUN_ACTION_ALLOWED_STATES.cancel,
      expect.any(Function),
      'run/cancelled',
    );
    expect(RUN_ACTION_ALLOWED_STATES.cancel).toContain('PAUSED_MANUAL');
  });

  it('marks every non-terminal stage_execution row cancelled when settling outstanding work', async () => {
    // Regression guard: a stage_execution frozen mid-flight (pending/
    // running/awaiting_*) when its run is cancelled used to sit unmarked
    // forever — the Run page would show "Pending"/"Running…" under an
    // overall Cancelled run. `settleOutstanding` must sweep those rows.
    const updates: Array<{ table: unknown; value: Record<string, unknown> }> = [];
    const db = {
      update: vi.fn((table: unknown) => ({
        set: vi.fn((value: Record<string, unknown>) => {
          updates.push({ table, value });
          return { where: vi.fn().mockResolvedValue(undefined) };
        }),
      })),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
          }),
        }),
      }),
    };
    const mutation = {
      withLockedRun: vi.fn(async (_id, _action, _states, callback) => {
        await callback(db);
        return { wakeupId: 'wake-cancel', revision: 1 };
      }),
    };
    const waits = { resolveAll: vi.fn() };
    const dispatcher = { dispatch: vi.fn() };
    const service = new RunCancellationService(
      mutation as never,
      dispatcher as never,
      waits as never,
      db as never,
      { get: vi.fn() } as never,
      { reservationIdFor: vi.fn() } as never,
    );

    await service.cancel('run-1');

    expect(updates).toContainEqual({
      table: stageExecution,
      value: { state: 'cancelled', endedAt: expect.any(String) },
    });
  });
});
