import { describe, expect, it, vi } from 'vitest';
import { HumanActionService } from './human-action.service';

describe('HumanActionService', () => {
  it('approves the pending candidate inside the locked mutation and resumes through the outbox', async () => {
    const tx = {};
    const mutation = {
      withLockedRun: vi.fn(async (_id, _action, _states, callback) => {
        await callback(tx, { cursorStageKey: 'review', revision: 2, blueprintVersionId: 'v1' });
        return { wakeupId: 'wake-approval', revision: 3 };
      }),
    };
    const service = Object.assign(Object.create(HumanActionService.prototype) as object, {
      mutation,
      dispatcher: { dispatch: vi.fn().mockResolvedValue(true) },
      approveInTransaction: vi.fn().mockResolvedValue(undefined),
    }) as unknown as HumanActionService;

    await service.approve('run-1', 'review');

    expect(mutation.withLockedRun).toHaveBeenCalledWith(
      'run-1',
      'approve',
      ['PAUSED_APPROVAL'],
      expect.any(Function),
      'run/resumed',
    );
    expect(
      (service as never as { approveInTransaction: ReturnType<typeof vi.fn> }).approveInTransaction,
    ).toHaveBeenCalledWith(tx, 'run-1', 'review', expect.any(Object), undefined);
  });
});
