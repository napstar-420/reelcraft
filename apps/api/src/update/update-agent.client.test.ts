import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EngineConfig } from '../config/engine-config';
import { UpdateAgentClient, UpdateAgentError } from './update-agent.client';

let dir: string;
let socketPath: string;
let server: Server | undefined;
const seen: Array<{ method: string | undefined; url: string | undefined; body: string }> = [];

function client() {
  return new UpdateAgentClient({ updaterSocket: socketPath } as EngineConfig);
}

function listen(handler: (body: string) => [number, unknown]): Promise<void> {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body });
      const [status, reply] = handler(body);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply));
    });
  });
  return new Promise((resolve) => server!.listen(socketPath, resolve));
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'agent-'));
  socketPath = path.join(dir, 'updater.sock');
  seen.length = 0;
});

afterEach(async () => {
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
  server = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe('UpdateAgentClient', () => {
  it('returns null when no agent is running', async () => {
    await expect(client().status()).resolves.toBeNull();
  });

  it('relays requests over the socket', async () => {
    await listen(() => [202, { phase: 'checking' }]);

    await expect(client().install('0.2.1')).resolves.toEqual({ phase: 'checking' });
    expect(seen).toEqual([{ method: 'POST', url: '/install', body: '{"version":"0.2.1"}' }]);
  });

  it("surfaces the agent's refusal with its status", async () => {
    await listen(() => [409, { message: 'An update is already in progress.' }]);

    const err = await client()
      .install('0.2.1')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpdateAgentError);
    expect(err).toMatchObject({ status: 409, message: 'An update is already in progress.' });
  });
});
