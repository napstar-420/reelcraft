import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:fs/promises', () => ({ ...mocks, open: vi.fn() }));

describe('Codex job runner failure reporting', () => {
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
  });

  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    process.argv = [process.execPath, 'codex-job-runner.js', '/tmp/codex-job/runner-request.json'];
    mocks.readFile.mockResolvedValue(
      JSON.stringify({
        modelId: 'gpt-example',
        reasoningEffort: 'high',
        jobDir: '/tmp/codex-job',
        resultPath: '/tmp/codex-job/result.txt',
        modality: 'text',
        profile: 'reelcraft',
        timeoutMs: 5000,
        params: {},
        prompt: 'test',
      }),
    );
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.rename.mockResolvedValue(undefined);
    mocks.unlink.mockResolvedValue(undefined);
  });

  async function failure(stdout: string, stderr = '', code: number | null = 1) {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: { end: vi.fn() },
      kill: vi.fn(),
    });
    mocks.spawn.mockReturnValue(child);
    child.stdin.end.mockImplementation(() => {
      setImmediate(() => {
        child.emit('exit', code, code === null ? 'SIGTERM' : null);
        // Pipes may deliver the failure after exit but before close.
        setImmediate(() => {
          child.stdout.emit('data', stdout);
          child.stderr.emit('data', stderr);
          child.emit('close', code, code === null ? 'SIGTERM' : null);
        });
      });
    });

    await import('./codex-job-runner');
    let status: { reason: string } | undefined;
    await vi.waitFor(() => {
      const call = mocks.writeFile.mock.calls.find(
        ([path, value]) =>
          String(path).includes('status.json') && JSON.parse(value).state === 'failed',
      );
      expect(call).toBeDefined();
      status = JSON.parse(call![1]);
    });
    return status!.reason;
  }

  it('surfaces the provider schema rejection from JSON encoded in turn.failed', async () => {
    const message = "Invalid schema: Missing 'attachments'.";
    const error = { message: JSON.stringify({ error: { message }, status: 400 }) };
    const events = [
      JSON.stringify({ type: 'error', message: error.message }),
      JSON.stringify({ type: 'turn.failed', error }),
    ].join('\n');
    expect(await failure(events, 'unrelated model refresh warning')).toBe(message);
  });

  it('uses the latest failure and ignores malformed or unrelated events', async () => {
    const events = [
      JSON.stringify({ type: 'error', message: 'Earlier error' }),
      JSON.stringify({ type: 'turn.failed', error: { message: 'Account limit reached' } }),
      JSON.stringify({ type: 'item.completed', message: 'unrelated' }),
      'null',
      '{incomplete',
    ].join('\n');
    expect(await failure(events)).toBe('Account limit reached');
  });

  it('redacts secrets in provider failures', async () => {
    expect(
      await failure(JSON.stringify({ type: 'error', message: 'Denied: Bearer test-credential' })),
    ).toBe('Denied: Bearer [REDACTED]');
  });

  it('falls back to redacted stderr when no usable failure event exists', async () => {
    expect(await failure('{bad json', 'Authentication failed: token=test-credential')).toBe(
      'Authentication failed: token=[REDACTED]',
    );
  });

  it('bounds the failure reason', async () => {
    expect(await failure('', 'x'.repeat(5000))).toHaveLength(4096);
  });

  it('keeps the exit code fallback when no diagnostics exist', async () => {
    expect(await failure('')).toBe('Codex exited with 1');
  });

  it('keeps the signal fallback when no diagnostics exist', async () => {
    expect(await failure('', '', null)).toBe('Codex exited with SIGTERM');
  });

  it('persists the initial persistent thread ID without affecting a successful result', async () => {
    const manifest = JSON.parse(
      await mocks.readFile('/tmp/codex-job/runner-request.json'),
    ) as Record<string, unknown>;
    mocks.readFile.mockResolvedValueOnce(JSON.stringify({ ...manifest, retained: true }));
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: { end: vi.fn() },
      kill: vi.fn(),
    });
    mocks.spawn.mockReturnValue(child);
    child.stdin.end.mockImplementation(() =>
      setImmediate(() => {
        child.stdout.emit(
          'data',
          '{"type":"thread.started","thread_id":"12345678-1234-1234-1234-123456789abc"}\n',
        );
        child.emit('close', 0, null);
      }),
    );
    await import('./codex-job-runner');
    await vi.waitFor(() =>
      expect(
        mocks.writeFile.mock.calls.some(
          ([path, value]) =>
            String(path).includes('thread.json') &&
            JSON.parse(value).threadId === '12345678-1234-1234-1234-123456789abc',
        ),
      ).toBe(true),
    );
    await vi.waitFor(() =>
      expect(
        mocks.writeFile.mock.calls.some(
          ([path, value]) =>
            String(path).includes('status.json') && JSON.parse(value).state === 'succeeded',
        ),
      ).toBe(true),
    );
  });
});
