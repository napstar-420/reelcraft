import { describe, expect, it, vi } from 'vitest';
import { RunActionPolicy } from './run-action-policy';
import { RunWakeupClaimService, type RunWakeupEventData } from './run-wakeup-claim.service';

function lockingQuery(rows: unknown[]) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    for: vi.fn().mockResolvedValue(rows),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  return query;
}

function serviceFor(wakeup: object, run: object) {
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const tx = {
    select: vi
      .fn()
      .mockReturnValueOnce(lockingQuery([wakeup]))
      .mockReturnValueOnce(lockingQuery([run])),
    update: vi.fn().mockReturnValue({ set: updateSet }),
  };
  const db = {
    transaction: vi.fn(async (callback: (arg: typeof tx) => unknown) => callback(tx)),
  };
  return { service: new RunWakeupClaimService(db as never, new RunActionPolicy()), tx, updateSet };
}

describe('RunWakeupClaimService', () => {
  const event: RunWakeupEventData = {
    wakeupId: 'wake-1',
    runId: 'run-1',
    action: 'resume',
    sourceState: 'FAILED',
    expectedRevision: 7,
  };
  const wakeup = {
    id: 'wake-1',
    runId: 'run-1',
    action: 'resume',
    sourceState: 'FAILED',
    expectedRevision: 7,
    claimedAt: null,
  };

  it('claims only an exact persisted event and atomically enters RUNNING', async () => {
    const { service, tx, updateSet } = serviceFor(wakeup, {
      id: 'run-1',
      state: 'FAILED',
      revision: 7,
    });

    await expect(service.claim(event)).resolves.toEqual({ claimed: true, runId: 'run-1' });
    expect(tx.update).toHaveBeenCalledTimes(2);
    expect(updateSet).toHaveBeenCalledWith({ state: 'RUNNING', endedAt: null });
    expect(updateSet).toHaveBeenCalledWith({ claimedAt: expect.any(String) });
  });

  it('ignores a delayed wakeup whose revision no longer matches', async () => {
    const { service, tx } = serviceFor(wakeup, {
      id: 'run-1',
      state: 'CANCELLED',
      revision: 8,
    });

    await expect(service.claim(event)).resolves.toEqual({
      claimed: false,
      reason: 'stale_revision',
    });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('ignores action/source-state payloads that do not match the outbox row', async () => {
    const { service, tx } = serviceFor(wakeup, {
      id: 'run-1',
      state: 'FAILED',
      revision: 7,
    });

    await expect(service.claim({ ...event, action: 'cancel' })).resolves.toEqual({
      claimed: false,
      reason: 'event_mismatch',
    });
    expect(tx.select).toHaveBeenCalledTimes(1);
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('treats an already-claimed wakeup as an idempotent no-op', async () => {
    const { service, tx } = serviceFor(
      { ...wakeup, claimedAt: 'earlier' },
      {
        id: 'run-1',
        state: 'RUNNING',
        revision: 7,
      },
    );

    await expect(service.claim(event)).resolves.toEqual({
      claimed: false,
      reason: 'already_claimed',
    });
    expect(tx.select).toHaveBeenCalledTimes(1);
    expect(tx.update).not.toHaveBeenCalled();
  });
});
