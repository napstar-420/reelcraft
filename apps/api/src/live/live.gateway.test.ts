import { describe, expect, it, vi } from 'vitest';
import { LiveEvents } from './live-events';
import { LiveGateway } from './live.gateway';

function setup(ownerRows: Array<{ ownerId: string }>, clients = 1) {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  const limit = vi.fn(async () => ownerRows);
  const db = {
    select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit }) }) }) }),
  };
  const events = new LiveEvents();
  const gateway = new LiveGateway(db as never, events);
  gateway.server = { to, engine: { clientsCount: clients } } as never;
  return { gateway, events, to, emit, limit };
}

describe('LiveGateway.route', () => {
  it('emits run updates to the owner room', async () => {
    const { gateway, to, emit } = setup([{ ownerId: 'local' }]);
    await gateway.route({ type: 'run', runId: 'r1' });
    expect(to).toHaveBeenCalledWith('user:local');
    expect(emit).toHaveBeenCalledWith('run:updated', { runId: 'r1' });
  });

  it('emits stage updates with the stage key', async () => {
    const { gateway, emit } = setup([{ ownerId: 'u2' }]);
    await gateway.route({ type: 'stage', runId: 'r1', stageKey: 'script' });
    expect(emit).toHaveBeenCalledWith('stage:updated', { runId: 'r1', stageKey: 'script' });
  });

  it('looks the owner up once per run', async () => {
    const { gateway, limit } = setup([{ ownerId: 'local' }]);
    await gateway.route({ type: 'run', runId: 'r1' });
    await gateway.route({ type: 'run', runId: 'r1' });
    expect(limit).toHaveBeenCalledTimes(1);
  });

  it('skips the lookup when nobody is connected', async () => {
    const { gateway, limit, emit } = setup([{ ownerId: 'local' }], 0);
    await gateway.route({ type: 'run', runId: 'r1' });
    expect(limit).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('drops events for runs that no longer exist', async () => {
    const { gateway, emit } = setup([]);
    await gateway.route({ type: 'run', runId: 'gone' });
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('LiveGateway notification events', () => {
  it('sends a notification to its recipient without looking up a run', async () => {
    const { gateway, to, emit, limit } = setup([]);
    const notification = { id: 'n1', title: 'Run completed' } as never;
    await gateway.route({ type: 'notification', recipientId: 'u2', notification });
    expect(to).toHaveBeenCalledWith('user:u2');
    expect(emit).toHaveBeenCalledWith('notification:created', notification);
    expect(limit).not.toHaveBeenCalled();
  });

  it('tells the recipient their read state changed', async () => {
    const { gateway, to, emit } = setup([]);
    await gateway.route({ type: 'notifications', recipientId: 'local' });
    expect(to).toHaveBeenCalledWith('user:local');
    expect(emit).toHaveBeenCalledWith('notifications:changed');
  });
});

describe('LiveGateway bus subscription', () => {
  it('survives a failing lookup without throwing out of the subscriber', async () => {
    const { gateway, events, limit } = setup([]);
    limit.mockRejectedValueOnce(new Error('db down'));
    gateway.afterInit();
    expect(() => events.publish({ type: 'run', runId: 'r1' })).not.toThrow();
    await new Promise((r) => setImmediate(r));
    gateway.onModuleDestroy();
  });
});
