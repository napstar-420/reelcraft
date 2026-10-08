import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HumanActionService } from './human-action.service';

describe('HumanActionService', () => {
  it('approves the pending candidate inside the locked mutation and resumes through the outbox', async () => {
    const tx = {};
    const mutation = {
      withLockedRunMaybeWake: vi.fn(async (_id, _action, _states, callback, _event, wake) => {
        const value = await callback(tx, {
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
      waits: { countOpenApprovals: vi.fn().mockResolvedValue(0) },
      dispatcher: { dispatch: vi.fn().mockResolvedValue(true) },
      approveInTransaction: vi.fn().mockResolvedValue(undefined),
    }) as unknown as HumanActionService;

    await service.approve('run-1', 'review');

    expect(mutation.withLockedRunMaybeWake).toHaveBeenCalledWith(
      'run-1',
      'approve',
      ['PAUSED_APPROVAL'],
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

  it('leaves the run paused while other items still wait for approval', async () => {
    const mutation = {
      withLockedRunMaybeWake: vi.fn(async (_id, _action, _states, callback, _event, wake) => {
        const value = await callback({}, { cursorStageKey: 'review' });
        return { value, wakeupId: wake(value) ? 'wake-approval' : undefined, revision: 3 };
      }),
    };
    const dispatch = vi.fn().mockResolvedValue(true);
    const service = Object.assign(Object.create(HumanActionService.prototype) as object, {
      mutation,
      logger: new Logger(HumanActionService.name),
      waits: { countOpenApprovals: vi.fn().mockResolvedValue(2) },
      dispatcher: { dispatch },
      approveInTransaction: vi.fn().mockResolvedValue(undefined),
    }) as unknown as HumanActionService;

    await expect(service.approve('run-1', 'review', 1)).resolves.toMatchObject({ accepted: true });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
