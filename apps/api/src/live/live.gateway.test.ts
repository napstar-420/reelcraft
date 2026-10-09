import { describe, expect, it, vi } from 'vitest';
import { LiveEvents } from './live-events';
import { LiveGateway } from './live.gateway';

function setup(ownerRows: Array<{ ownerId: string }>, clients = 1) {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  const limit = vi.fn(async () => ownerRows);
  const where = () => ({ limit });
  // run -> channel is one join, session -> blueprint -> channel is two
  const db = {
    select: () => ({
      from: () => ({ innerJoin: () => ({ where, innerJoin: () => ({ where }) }) }),
    }),
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

describe('LiveGateway assistant events', () => {
  const event = { type: 'delta', turnId: 't', itemId: 'i', text: 'hi' } as const;

  it('sends a chat event only to the chat room, without an owner lookup', async () => {
    const { gateway, to, emit, limit } = setup([]);
    await gateway.route({ type: 'assistant', sessionId: 's1', event });
    expect(to).toHaveBeenCalledWith('assistant:s1');
    expect(emit).toHaveBeenCalledWith('assistant:event', { sessionId: 's1', event });
    expect(limit).not.toHaveBeenCalled();
  });
});

describe('LiveGateway.watch', () => {
  function socketFor() {
    return {
      id: 'sock1',
      handshake: {},
      join: vi.fn(async () => undefined),
      leave: vi.fn(async () => undefined),
    };
  }

  it('joins the chat room for the chat’s owner and says so', async () => {
    const { gateway } = setup([{ ownerId: 'local' }]);
    const socket = socketFor();
    await expect(gateway.watch(socket as never, 's1')).resolves.toBe(true);
    expect(socket.join).toHaveBeenCalledWith('assistant:s1');
  });

  it('refuses a chat that belongs to someone else, or does not exist', async () => {
    const other = setup([{ ownerId: 'someone-else' }]);
    const socket = socketFor();
    await expect(other.gateway.watch(socket as never, 's1')).resolves.toBe(false);
    const missing = setup([]);
    await expect(missing.gateway.watch(socket as never, 's1')).resolves.toBe(false);
    expect(socket.join).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 42, '', 'x'.repeat(65), { id: 's1' }])(
    'refuses a malformed id %j without touching the database',
    async (id) => {
      const { gateway, limit } = setup([{ ownerId: 'local' }]);
      const socket = socketFor();
      await expect(gateway.watch(socket as never, id)).resolves.toBe(false);
      expect(limit).not.toHaveBeenCalled();
      expect(socket.join).not.toHaveBeenCalled();
    },
  );

  it('does not join when the socket unwatched while the owner lookup was running', async () => {
    const { gateway, limit } = setup([{ ownerId: 'local' }]);
    let release!: () => void;
    limit.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve([{ ownerId: 'local' }]))),
    );
    const socket = socketFor();

    const pending = gateway.watch(socket as never, 's1');
    await gateway.unwatch(socket as never, 's1');
    release();

    await expect(pending).resolves.toBe(false);
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('lets the newest of two overlapping watches join', async () => {
    const { gateway, limit } = setup([{ ownerId: 'local' }]);
    const releases: Array<() => void> = [];
    limit.mockImplementation(
      () => new Promise((resolve) => releases.push(() => resolve([{ ownerId: 'local' }]))),
    );
    const socket = socketFor();

    const first = gateway.watch(socket as never, 's1');
    await gateway.unwatch(socket as never, 's1');
    const second = gateway.watch(socket as never, 's1');
    releases.forEach((release) => release());

    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
    expect(socket.join).toHaveBeenCalledTimes(1);
  });

  it('forgets a socket’s requests when it disconnects', async () => {
    const { gateway } = setup([{ ownerId: 'local' }]);
    const socket = socketFor();
    await gateway.watch(socket as never, 's1');
    gateway.handleDisconnect(socket as never);
    await expect(gateway.watch(socket as never, 's1')).resolves.toBe(true);
  });

  it('leaves the room on unwatch and ignores a malformed id', async () => {
    const { gateway } = setup([]);
    const socket = socketFor();
    await gateway.unwatch(socket as never, 's1');
    await gateway.unwatch(socket as never, 99);
    expect(socket.leave).toHaveBeenCalledTimes(1);
    expect(socket.leave).toHaveBeenCalledWith('assistant:s1');
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
