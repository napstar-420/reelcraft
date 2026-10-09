import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type { StageDef } from '@reelcraft/shared';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { ChannelService } from '../../src/channel/channel.service';
import { buildHttpTestApp, type HttpTestApp } from '../support/build-http-test-app';
import { createTestDb, type TestDb } from '../support/test-db';

const stage: StageDef = {
  key: 'draft',
  label: 'draft',
  capability: 'text.generate',
  config: {},
  slots: {},
  context: {},
  output: { kind: 'text' },
  checks: [],
  retryLimit: 0,
  model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 64 } },
};

describe('live updates over Socket.IO (e2e)', () => {
  let testDb: TestDb;
  let http: HttpTestApp;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    testDb = await createTestDb();
    http = await buildHttpTestApp(testDb);
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    try {
      await http?.close();
    } finally {
      await testDb.teardown();
    }
  });

  const origin = () => new URL(http.baseUrl).origin;

  function connect(extraHeaders?: Record<string, string>, transports: string[] = ['websocket']) {
    const socket = io(origin(), {
      path: '/api/socket.io',
      transports,
      reconnection: false,
      ...(extraHeaders && { extraHeaders }),
    });
    sockets.push(socket);
    return socket;
  }

  const connected = (socket: Socket) =>
    new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });

  async function createRun() {
    const channel = await http.app.get(ChannelService).create('local', {
      name: `Live ${Date.now()} ${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprints = http.app.get(BlueprintService);
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Live updates');
    const version = await blueprints.createVersion(blueprintId, {
      graph: [stage],
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    return { channelId: channel.id, blueprintVersionId: version.id };
  }

  async function post(path: string, body?: unknown) {
    const res = await fetch(`${http.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    expect(res.ok, `${path} -> ${res.status}`).toBe(true);
    return (await res.json()) as { id: string };
  }

  it('pushes run:updated to a connected client when a run is created and then cancelled', async () => {
    const socket = connect();
    await connected(socket);
    const seen: string[] = [];
    socket.on('run:updated', (payload: { runId: string }) => seen.push(payload.runId));

    const { channelId, blueprintVersionId } = await createRun();
    const created = await post('/runs', {
      channelId,
      blueprintVersionId,
      inputs: {},
      roleBindings: {},
      rerunStageKeys: [],
      budgetCapUsd: 10,
    });
    await expect.poll(() => seen.filter((id) => id === created.id).length).toBe(1);

    await post(`/runs/${created.id}/cancel`);
    await expect.poll(() => seen.filter((id) => id === created.id).length).toBeGreaterThan(1);
  });

  it('works over the long-polling transport too', async () => {
    const socket = connect(undefined, ['polling']);
    await connected(socket);
    expect(socket.connected).toBe(true);
  });

  it('refuses a handshake from a foreign origin on either transport', async () => {
    for (const transports of [['websocket'], ['polling']]) {
      const socket = connect({ Origin: 'http://evil.test' }, transports);
      await expect(connected(socket)).rejects.toBeInstanceOf(Error);
      expect(socket.connected).toBe(false);
    }
  });

  it('accepts a handshake from the same origin', async () => {
    const socket = connect({ Origin: origin() });
    await connected(socket);
    expect(socket.connected).toBe(true);
  });
});
