import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CodexRpcConnection, initializeCodexRpc } from './codex-rpc';

function fakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();
  const written: Array<Record<string, unknown>> = [];
  proc.stdin.on('data', (chunk) => {
    for (const line of chunk.toString().trim().split('\n')) written.push(JSON.parse(line));
  });
  const send = (message: unknown) => proc.stdout.write(`${JSON.stringify(message)}\n`);
  return { proc, written, send };
}

function open(proc: ReturnType<typeof fakeProc>['proc'], timeoutMs = 1_000) {
  return CodexRpcConnection.open((() => proc) as never, ['app-server'], {
    logger: new Logger('test'),
    defaultTimeoutMs: timeoutMs,
  });
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('CodexRpcConnection', () => {
  it('matches responses to requests, and rejects error replies', async () => {
    const { proc, written, send } = fakeProc();
    const connection = open(proc);
    const ok = connection.request('a', { x: 1 });
    const bad = connection.request('b', {});
    await tick();
    expect(written).toEqual([
      { id: 1, method: 'a', params: { x: 1 } },
      { id: 2, method: 'b', params: {} },
    ]);
    send({ id: 2, error: { message: 'nope' } });
    send({ id: 1, result: { fine: true } });
    await expect(ok).resolves.toEqual({ fine: true });
    await expect(bad).rejects.toThrow('nope');
  });

  it('times a request out', async () => {
    const { proc } = fakeProc();
    const connection = open(proc, 20);
    await expect(connection.request('slow', {})).rejects.toThrow(/slow timed out/);
  });

  it('delivers notifications and ignores non-JSON lines', async () => {
    const { proc, send } = fakeProc();
    const connection = open(proc);
    const seen: unknown[] = [];
    connection.onNotification((method, params) => seen.push([method, params]));
    proc.stdout.write('not json\n');
    send({ method: 'turn/started', params: { threadId: 't' } });
    await tick();
    expect(seen).toEqual([['turn/started', { threadId: 't' }]]);
  });

  it('answers requests from the server, or replies with an error when the handler throws', async () => {
    const { proc, written, send } = fakeProc();
    const connection = open(proc);
    connection.onServerRequest(async (method) => {
      if (method === 'ok') return { fine: 1 };
      throw new Error('Denied by Reelcraft');
    });
    send({ id: 7, method: 'ok', params: {} });
    send({ id: 8, method: 'bad', params: {} });
    await tick();
    expect(written).toEqual([
      { id: 7, result: { fine: 1 } },
      { id: 8, error: { code: -32601, message: 'Denied by Reelcraft' } },
    ]);
  });

  it('denies server requests when no handler is set', async () => {
    const { proc, written, send } = fakeProc();
    open(proc);
    send({ id: 1, method: 'item/commandExecution/requestApproval', params: {} });
    await tick();
    expect(written[0]).toMatchObject({ id: 1, error: { message: 'Denied by Reelcraft' } });
  });

  it('rejects pending requests and resolves `exited` when the process ends', async () => {
    const { proc } = fakeProc();
    const connection = open(proc);
    const pending = connection.request('x', {});
    proc.stderr.write('boom');
    await tick();
    proc.emit('exit', 2, null);
    await expect(pending).rejects.toThrow('Codex app-server exited (2): boom');
    await expect(connection.exited).resolves.toMatchObject({ code: 2, stderr: 'boom' });
  });

  it('distinguishes a deliberate close from a crash', async () => {
    const { proc } = fakeProc();
    const connection = open(proc);
    expect(connection.isClosing).toBe(false);
    connection.close();
    expect(connection.isClosing).toBe(true);
    expect(proc.kill).toHaveBeenCalled();
  });

  it('opts into the experimental API when initializing', async () => {
    const { proc, written, send } = fakeProc();
    const connection = open(proc);
    const init = initializeCodexRpc(connection, 'reelcraft-test');
    await tick();
    send({ id: 1, result: {} });
    await init;
    expect(written[0]).toMatchObject({
      method: 'initialize',
      params: { clientInfo: { name: 'reelcraft-test' }, capabilities: { experimentalApi: true } },
    });
    expect(written[1]).toEqual({ method: 'initialized', params: {} });
  });

  it('fails clearly when the codex CLI cannot be started', () => {
    expect(() =>
      CodexRpcConnection.open(
        (() => {
          throw new Error('spawn codex ENOENT');
        }) as never,
        [],
        { logger: new Logger('test'), defaultTimeoutMs: 10 },
      ),
    ).toThrow(/Codex CLI is unavailable/);
  });
});
