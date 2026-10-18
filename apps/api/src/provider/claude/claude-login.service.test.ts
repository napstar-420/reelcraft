import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ClaudeLoginService } from './claude-login.service';
import { claudeCallbackCode, isClaudeAuthorizeUrl, parseClaudeLoginUrl } from './claude-login-page';

const AUTHORIZE =
  'https://claude.com/cai/oauth/authorize?code=true&client_id=abc&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=s1';
const CALLBACK = 'https://platform.claude.com/oauth/code/callback?code=c1&state=s1';

/** What Claude Code 2.1.286 prints for `claude auth login` without a TTY. */
const LOGIN_OUTPUT = `Opening browser to sign in…\nIf the browser didn't open, visit: ${AUTHORIZE}\nPaste code here if prompted > `;

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = Object.assign(new EventEmitter(), { write: vi.fn() });
  killed = false;
  kill() {
    this.killed = true;
    this.emit('close', null);
    return true;
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function fixture(neoUrls: Array<string | Error> = []) {
  const child = new FakeChild();
  const neo = {
    run: vi.fn(async (code: string) => {
      if (code.includes('newPage')) return 7;
      const next = neoUrls.shift() ?? AUTHORIZE;
      if (next instanceof Error) throw next;
      return next;
    }),
  };
  const readiness = {
    reset: vi.fn(),
    inspect: vi.fn(async () => ({ modalities: ['text' as const], unavailable: {} })),
  };
  const runClaude = vi.fn(async () => ({ code: 0, stdout: '{"loggedIn":false}' }));
  const service = new ClaudeLoginService(neo as never, readiness, {
    spawnClaude: () => child as unknown as ChildProcess,
    runClaude,
    watchIntervalMs: 1,
  });
  return { service, child, neo, readiness, runClaude };
}

describe('Claude login addresses', () => {
  it('finds the authorize link in the CLI output', () => {
    expect(parseClaudeLoginUrl(LOGIN_OUTPUT)).toBe(AUTHORIZE);
    expect(parseClaudeLoginUrl('visit: https://evil.example/oauth/authorize?x=1')).toBeNull();
  });

  it('accepts only Anthropic authorize pages', () => {
    expect(isClaudeAuthorizeUrl(AUTHORIZE)).toBe(true);
    expect(isClaudeAuthorizeUrl('http://claude.com/cai/oauth/authorize')).toBe(false);
    expect(isClaudeAuthorizeUrl('https://claude.com.evil.example/oauth/authorize')).toBe(false);
  });

  it('reads code#state only from the callback page for this sign-in', () => {
    expect(claudeCallbackCode(CALLBACK, AUTHORIZE)).toBe('c1#s1');
    expect(claudeCallbackCode(CALLBACK.replace('state=s1', 'state=other'), AUTHORIZE)).toBeNull();
    expect(
      claudeCallbackCode('https://evil.example/oauth/code/callback?code=c1&state=s1', AUTHORIZE),
    ).toBeNull();
    expect(claudeCallbackCode(AUTHORIZE, AUTHORIZE)).toBeNull();
  });
});

describe('ClaudeLoginService', () => {
  it('opens the link in Neo and types the callback code into the CLI', async () => {
    const { service, child, neo, readiness } = fixture([AUTHORIZE, CALLBACK]);
    expect(service.start().phase).toBe('starting');
    child.stdout.emit('data', LOGIN_OUTPUT);
    await vi.waitFor(() => expect(child.stdin.write).toHaveBeenCalledWith('c1#s1\n'));
    expect(neo.run.mock.calls[0]![0]).toContain(JSON.stringify(AUTHORIZE));
    expect(service.getLogin()).toMatchObject({ phase: 'waiting-for-approval', neo: 'entered' });
    child.emit('close', 0);
    expect(service.getLogin()?.phase).toBe('connected');
    expect(readiness.reset).toHaveBeenCalled();
  });

  it('runs one sign-in at a time', () => {
    const { service } = fixture();
    service.start();
    expect(() => service.start()).toThrow(ConflictException);
  });

  it('falls back to a pasted code when Neo is unreachable', async () => {
    const { service, child, neo } = fixture();
    neo.run.mockRejectedValueOnce(new Error('Neo is down'));
    service.start();
    child.stdout.emit('data', LOGIN_OUTPUT);
    await vi.waitFor(() => expect(service.getLogin()?.neo).toBe('failed'));
    expect(service.getLogin()).toMatchObject({ url: AUTHORIZE, neoMessage: 'Neo is down' });
    service.submitCode('  pasted#s1 ');
    expect(child.stdin.write).toHaveBeenCalledWith('pasted#s1\n');
  });

  it('refuses a pasted code with no sign-in running', () => {
    expect(() => fixture().service.submitCode('x')).toThrow(BadRequestException);
  });

  it('reports the CLI error when the sign-in fails', async () => {
    const { service, child } = fixture();
    service.start();
    child.stdout.emit('data', LOGIN_OUTPUT);
    child.stdout.emit('data', 'Invalid code. Please make sure the full code was copied.\n');
    child.emit('close', 1);
    await flush();
    expect(service.getLogin()).toMatchObject({
      phase: 'failed',
      error: 'Invalid code. Please make sure the full code was copied.',
    });
  });

  it('cancels a running sign-in', () => {
    const { service, child } = fixture();
    service.start();
    expect(service.cancel()?.phase).toBe('cancelled');
    expect(child.killed).toBe(true);
  });
});
