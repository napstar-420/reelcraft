import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HumanActionService } from './human-action.service';

describe('HumanActionService', () => {
  it('approves the pending candidate inside the locked mutation and resumes through the outbox', async () => {
    const tx = {};
    const mutation = {
      withLockedRunMaybeWake: vi.fn(async (_id, _action, _states, callback, _event, wake) => {
        const value = await callback(tx, {
          id: 'run-1',
          state: 'PAUSED_APPROVAL',
          cursorStageKey: 'review',
          revision: 2,
          blueprintVersionId: 'v1',
        });
        return { value, wakeupId: wake(value) ? 'wake-approval' : undefined, revision: 3 };
      }),
    };
    const service = Object.assign(Object.create(HumanActionService.prototype) as object, {
      mutation,
      logger: new Logger(HumanActionService.name),
      waits: { pausedStateFor: vi.fn().mockResolvedValue(undefined) },
      dispatcher: { dispatch: vi.fn().mockResolvedValue(true) },
      approveInTransaction: vi.fn().mockResolvedValue(undefined),
    }) as unknown as HumanActionService;

    await service.approve('run-1', 'review');

    expect(mutation.withLockedRunMaybeWake).toHaveBeenCalledWith(
      'run-1',
      'approve',
      expect.arrayContaining(['PAUSED_APPROVAL', 'PAUSED_INPUT', 'FAILED']),
      expect.any(Function),
      'run/resumed',
      expect.any(Function),
    );
    expect(
      (service as never as { dispatcher: { dispatch: ReturnType<typeof vi.fn> } }).dispatcher
        .dispatch,
    ).toHaveBeenCalledWith('wake-approval');
    expect(
      (service as never as { approveInTransaction: ReturnType<typeof vi.fn> }).approveInTransaction,
    ).toHaveBeenCalledWith(tx, 'run-1', 'review', expect.any(Object), undefined);
  });

  it('leaves the run paused while other waits are still open', async () => {
    const setState = vi.fn().mockReturnValue({ where: vi.fn() });
    const tx = { update: vi.fn().mockReturnValue({ set: setState }) };
    const mutation = {
      withLockedRunMaybeWake: vi.fn(async (_id, _action, _states, callback, _event, wake) => {
        const value = await callback(tx, {
          id: 'run-1',
          state: 'PAUSED_APPROVAL',
          cursorStageKey: 'review',
        });
        return { value, wakeupId: wake(value) ? 'wake-approval' : undefined, revision: 3 };
      }),
    };
    const dispatch = vi.fn().mockResolvedValue(true);
    const pausedStateFor = vi.fn().mockResolvedValue('PAUSED_INPUT');
    const service = Object.assign(Object.create(HumanActionService.prototype) as object, {
      mutation,
      logger: new Logger(HumanActionService.name),
      waits: { pausedStateFor },
      dispatcher: { dispatch },
      approveInTransaction: vi.fn().mockResolvedValue(undefined),
    }) as unknown as HumanActionService;

    await expect(service.approve('run-1', 'review', 1)).resolves.toMatchObject({ accepted: true });
    expect(dispatch).not.toHaveBeenCalled();
    // Parked in the state of the wait still open, so the next answer is accepted.
    expect(setState).toHaveBeenCalledWith({ state: 'PAUSED_INPUT' });
  });

  it('records an answer on a failed run without waking it or changing its state', async () => {
    const setState = vi.fn().mockReturnValue({ where: vi.fn() });
    const tx = { update: vi.fn().mockReturnValue({ set: setState }) };
    const mutation = {
      withLockedRunMaybeWake: vi.fn(async (_id, _action, _states, callback, _event, wake) => {
        const value = await callback(tx, { id: 'run-1', state: 'FAILED', cursorStageKey: 'x' });
        return { value, wakeupId: wake(value) ? 'wake-approval' : undefined, revision: 3 };
      }),
    };
    const dispatch = vi.fn().mockResolvedValue(true);
    const pausedStateFor = vi.fn().mockResolvedValue(undefined);
    const approveInTransaction = vi.fn().mockResolvedValue(undefined);
    const service = Object.assign(Object.create(HumanActionService.prototype) as object, {
      mutation,
      logger: new Logger(HumanActionService.name),
      waits: { pausedStateFor },
      dispatcher: { dispatch },
      approveInTransaction,
    }) as unknown as HumanActionService;

    await expect(service.approve('run-1', 'images', 12)).resolves.toMatchObject({
      accepted: true,
    });
    expect(approveInTransaction).toHaveBeenCalled();
    // Stays FAILED: no wakeup, no paused state written. Continue picks the answer up.
    expect(dispatch).not.toHaveBeenCalled();
    expect(setState).not.toHaveBeenCalled();
    expect(pausedStateFor).not.toHaveBeenCalled();
  });
});
