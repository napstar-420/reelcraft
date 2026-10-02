import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { ConflictException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexLoginService, parseDeviceAuthOutput } from './codex-login.service';

/** What codex-cli 0.159.3 prints for `codex login --device-auth`. */
const DEVICE_OUTPUT = [
  '',
  'Welcome to Codex [v0.159.3]',
  "OpenAI's command-line coding agent",
  '',
  'Follow these steps to sign in with ChatGPT using device code authorization:',
  '',
  '1. Open this link in your browser and sign in to your account',
  '   \u001b[94mhttps://auth.openai.com/codex/device\u001b[0m',
  '',
  '2. Enter this one-time code \u001b[90m(expires in 15 minutes)\u001b[0m',
  '   \u001b[94mABCD-EF123\u001b[0m',
  '',
  '\u001b[90mDevice codes are a common phishing target. Never share this code.\u001b[0m',
  '',
].join('\n');

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill() {
    this.killed = true;
    this.emit('close', null);
    return true;
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function fixture(opts: { neo?: (code: string) => unknown; loggedIn?: boolean } = {}) {
  const child = new FakeChild();
  const neo = {
    run: vi.fn(async (code: string) => (opts.neo ? opts.neo(code) : 1)),
  };
  const models = { reset: vi.fn() };
  const readiness = {
    reset: vi.fn(),
    inspect: vi.fn(async () => ({ modalities: ['text' as const], unavailable: {} })),
  };
  const registrar = { ensure: vi.fn(async () => 'reelcraft' as const), status: vi.fn() };
  registrar.status.mockResolvedValue('missing');
  const runCodex = vi.fn(async (args: string[]) =>
    args[0] === 'login'
      ? opts.loggedIn
        ? { code: 0, output: 'Logged in using ChatGPT\n' }
        : { code: 1, output: 'Not logged in\n' }
      : { code: 0, output: '' },
  );
  const service = new CodexLoginService(neo as never, models, readiness, registrar as never, {
    spawnCodex: () => child as unknown as ChildProcess,
    runCodex,
  });
  return { service, child, neo, models, readiness, registrar, runCodex };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('parseDeviceAuthOutput', () => {
  it('finds the link and code in the CLI output', () => {
    expect(parseDeviceAuthOutput(DEVICE_OUTPUT)).toEqual({
      url: 'https://auth.openai.com/codex/device',
      code: 'ABCD-EF123',
    });
  });

  it('waits until both are printed', () => {
    expect(parseDeviceAuthOutput(DEVICE_OUTPUT.split('2. Enter')[0]!)).toBeNull();
  });
});

describe('CodexLoginService', () => {
  it('enters the code in Neo, waits for approval, then connects', async () => {
    const { service, child, neo, models, readiness, registrar } = fixture({
      neo: (code) => (code.includes('newPage') ? 4 : { status: 'entered' }),
    });
    expect(service.start().phase).toBe('starting');
    child.stdout.emit('data', DEVICE_OUTPUT);
    expect(service.getLogin()).toMatchObject({
      phase: 'opening-neo',
      url: 'https://auth.openai.com/codex/device',
      code: 'ABCD-EF123',
    });
    await flush();
    expect(neo.run).toHaveBeenCalledTimes(2);
    expect(neo.run.mock.calls[1]![0]).toContain('ABCD-EF123');
    expect(service.getLogin()).toMatchObject({ phase: 'waiting-for-approval', neo: 'entered' });

    child.emit('close', 0);
    await flush();
    expect(service.getLogin()).toMatchObject({ phase: 'connected', error: null });
    expect(models.reset).toHaveBeenCalled();
    expect(readiness.reset).toHaveBeenCalled();
    expect(registrar.ensure).toHaveBeenCalled();
  });

  it('falls back to the link and code when Neo is unavailable', async () => {
    const { service, child } = fixture({
      neo: () => {
        throw new Error('BrowserOS Neo is unavailable: fetch failed');
      },
    });
    service.start();
    child.stdout.emit('data', DEVICE_OUTPUT);
    await flush();
    expect(service.getLogin()).toMatchObject({
      phase: 'waiting-for-approval',
      neo: 'failed',
      neoMessage: 'BrowserOS Neo is unavailable: fetch failed',
      code: 'ABCD-EF123',
    });
  });

  it('asks the user to sign in to OpenAI in Neo first', async () => {
    const { service, child } = fixture({
      neo: (code) => (code.includes('newPage') ? 4 : { status: 'needs-sign-in' }),
    });
    service.start();
    child.stdout.emit('data', DEVICE_OUTPUT);
    await flush();
    expect(service.getLogin()).toMatchObject({ neo: 'needs-sign-in' });
    expect(service.getLogin()?.neoMessage).toMatch(/Sign in/);
  });

  it('never sends the code to a page that is not OpenAI', async () => {
    const { service, child, neo } = fixture();
    service.start();
    child.stdout.emit('data', DEVICE_OUTPUT.replace('auth.openai.com', 'evil.example'));
    await flush();
    expect(neo.run).not.toHaveBeenCalled();
    expect(service.getLogin()).toMatchObject({ neo: 'skipped', phase: 'waiting-for-approval' });
  });

  it('allows one sign-in at a time and can cancel it', () => {
    const { service, child } = fixture();
    service.start();
    expect(() => service.start()).toThrow(ConflictException);
    expect(service.cancel()?.phase).toBe('cancelled');
    expect(child.killed).toBe(true);
    expect(service.getLogin()?.phase).toBe('cancelled');
  });

  it('reports a failed sign-in with the CLI message', async () => {
    const { service, child } = fixture();
    service.start();
    child.stderr.emit('data', 'Error logging in with device code: denied\n');
    child.emit('close', 1);
    await flush();
    expect(service.getLogin()).toMatchObject({
      phase: 'failed',
      error: 'Error logging in with device code: denied',
    });
  });

  it('gives up when Codex prints no code', () => {
    vi.useFakeTimers();
    const { service, child } = fixture();
    service.start();
    vi.advanceTimersByTime(31_000);
    expect(service.getLogin()).toMatchObject({ phase: 'failed' });
    expect(child.killed).toBe(true);
  });

  it('reports status from codex login status', async () => {
    const { service } = fixture({ loggedIn: true });
    await expect(service.status()).resolves.toMatchObject({
      installed: true,
      connected: true,
      detail: 'Logged in using ChatGPT',
      modalities: ['text'],
      neoRegistration: 'missing',
      login: null,
    });
  });

  it('reports a missing CLI', async () => {
    const { service, runCodex } = fixture();
    runCodex.mockRejectedValue(Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }));
    await expect(service.status()).resolves.toMatchObject({
      installed: false,
      connected: false,
      neoRegistration: 'unknown',
    });
  });
});
