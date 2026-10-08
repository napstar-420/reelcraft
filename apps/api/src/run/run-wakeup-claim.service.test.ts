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
  const events = { publish: vi.fn() };
  const notifications = { insertSafely: vi.fn().mockResolvedValue(null), deliver: vi.fn() };
  return {
    service: new RunWakeupClaimService(
      db as never,
      new RunActionPolicy(),
      events as never,
      notifications as never,
    ),
    tx,
    updateSet,
    events,
    notifications,
  };
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
    const { service, tx, updateSet, events } = serviceFor(wakeup, {
      id: 'run-1',
      state: 'FAILED',
      revision: 7,
    });

    await expect(service.claim(event)).resolves.toEqual({ claimed: true, runId: 'run-1' });
    expect(events.publish).toHaveBeenCalledWith({ type: 'run', runId: 'run-1' });
    expect(tx.update).toHaveBeenCalledTimes(2);
    expect(updateSet).toHaveBeenCalledWith({ state: 'RUNNING', endedAt: null });
    expect(updateSet).toHaveBeenCalledWith({ claimedAt: expect.any(String) });
  });

  it('ignores a delayed wakeup whose revision no longer matches', async () => {
    const { service, tx, events } = serviceFor(wakeup, {
      id: 'run-1',
      state: 'CANCELLED',
      revision: 8,
    });

    await expect(service.claim(event)).resolves.toEqual({
      claimed: false,
      reason: 'stale_revision',
    });
    expect(events.publish).not.toHaveBeenCalled();
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

  describe('notifications', () => {
    const sent = { recipientId: 'local', notification: { id: 'n1' } };

    it('records and announces "run started" for a start wakeup, keyed by the wakeup', async () => {
      const startWakeup = { ...wakeup, action: 'start', sourceState: 'CREATED' };
      const { service, tx, notifications } = serviceFor(startWakeup, {
        id: 'run-1',
        state: 'CREATED',
        revision: 7,
      });
      notifications.insertSafely.mockResolvedValue(sent);

      await service.claim({ ...event, action: 'start', sourceState: 'CREATED' });

      expect(notifications.insertSafely).toHaveBeenCalledWith(tx, {
        runId: 'run-1',
        kind: 'run_started',
        dedupeKey: 'run_started:wake-1',
      });
      expect(notifications.deliver).toHaveBeenCalledWith(sent);
    });

    it('records "auto resumed" only for the timed wakeup of a quota pause', async () => {
      const timed = { ...wakeup, sourceState: 'PAUSED_QUOTA', notBefore: '2026-10-09T00:00:00Z' };
      const { service, notifications } = serviceFor(timed, {
        id: 'run-1',
        state: 'PAUSED_QUOTA',
        revision: 7,
      });

      await service.claim({ ...event, sourceState: 'PAUSED_QUOTA' });

      expect(notifications.insertSafely).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ kind: 'auto_resumed', dedupeKey: 'auto_resumed:wake-1' }),
      );
    });

    it('stays quiet when the user resumes a quota pause by hand', async () => {
      const manual = { ...wakeup, sourceState: 'PAUSED_QUOTA', notBefore: null };
      const { service, notifications } = serviceFor(manual, {
        id: 'run-1',
        state: 'PAUSED_QUOTA',
        revision: 7,
      });

      await service.claim({ ...event, sourceState: 'PAUSED_QUOTA' });

      expect(notifications.insertSafely).not.toHaveBeenCalled();
    });

    it('stays quiet for an ordinary resume and for a claim that was rejected', async () => {
      const ordinary = serviceFor(wakeup, { id: 'run-1', state: 'FAILED', revision: 7 });
      await ordinary.service.claim(event);
      expect(ordinary.notifications.insertSafely).not.toHaveBeenCalled();

      const stale = serviceFor(wakeup, { id: 'run-1', state: 'CANCELLED', revision: 8 });
      await stale.service.claim(event);
      expect(stale.notifications.deliver).not.toHaveBeenCalled();
    });
  });
});
