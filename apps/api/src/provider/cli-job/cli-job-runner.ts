import { spawn } from 'node:child_process';
import { open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { claudeDialect } from '../claude/claude-command';
import { codexDialect } from '../codex/codex-command';
import type { CliDialect, CliEvent, CliKind, CliRunnerManifest } from './cli-dialect';

const DIALECTS: Record<CliKind, CliDialect> = { codex: codexDialect, claude: claudeDialect };

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  await rename(temp, path);
}

function appendBounded(current: string, chunk: unknown, limit: number): string {
  const next = current + String(chunk);
  return next.length <= limit ? next : next.slice(-limit);
}

function parseEvent(line: string): CliEvent | undefined {
  try {
    const event = JSON.parse(line) as unknown;
    return event && typeof event === 'object' ? (event as CliEvent) : undefined;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const manifestPath = process.argv[2];
  if (!manifestPath) throw new Error('CLI job runner requires a manifest path');
  const manifestJson = await readFile(manifestPath, 'utf8');
  await unlink(manifestPath);
  const manifest = JSON.parse(manifestJson) as CliRunnerManifest;
  const dialect = DIALECTS[manifest.cli ?? 'codex'];
  const statusPath = join(manifest.jobDir, 'status.json');
  const releaseBrowserLock =
    manifest.modality === 'browser' ? await acquireBrowserLock(manifest) : undefined;
  const releaseOnSignal = () => {
    void releaseBrowserLock?.().finally(() => process.exit(143));
  };
  if (releaseBrowserLock) {
    process.once('SIGTERM', releaseOnSignal);
    process.once('SIGINT', releaseOnSignal);
  }
  await atomicJson(statusPath, {
    state: 'running',
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
  const child = spawn(dialect.command, await dialect.args(manifest), {
    cwd: manifest.jobDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });
  let events = '';
  let stderr = '';
  let eventBuffer = '';
  let browserSteps = 0;
  let browserStepLimitExceeded = false;
  let threadWrite: Promise<void> | undefined;
  let result: { text: string } | { error: string } | undefined;
  const onLine = (line: string) => {
    const event = parseEvent(line);
    if (event && manifest.retained && !manifest.threadId && !threadWrite) {
      const threadId = dialect.sessionId(event);
      if (threadId && /^[a-f0-9-]{36}$/i.test(threadId)) {
        threadWrite = atomicJson(join(manifest.jobDir, 'thread.json'), {
          threadId,
          createdAt: new Date().toISOString(),
        });
      }
    }
    if (event && dialect.result) result = dialect.result(event, manifest) ?? result;
    if (manifest.modality === 'browser') {
      browserSteps += dialect.browserSteps(line, event);
      if (browserSteps > manifest.browserMaxSteps && !browserStepLimitExceeded) {
        browserStepLimitExceeded = true;
        child.kill('SIGTERM');
      }
    }
  };
  child.stdout.on('data', (chunk) => {
    events = appendBounded(events, chunk, 1024 * 1024);
    eventBuffer += String(chunk);
    const lines = eventBuffer.split('\n');
    eventBuffer = lines.pop() ?? '';
    for (const line of lines) onLine(line);
  });
  child.stderr.on('data', (chunk) => {
    stderr = appendBounded(stderr, chunk, 64 * 1024);
  });
  child.stdin.end(manifest.prompt);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
  }, manifest.timeoutMs);
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once('error', reject);
      // Wait for stdout/stderr to drain so the final failure event is available.
      child.once('close', (code, signal) => resolve({ code, signal }));
    },
  ).catch((error: Error) => ({ code: -1, signal: null, error }));
  clearTimeout(timeout);
  if (eventBuffer.trim()) onLine(eventBuffer);
  await threadWrite?.catch(() => undefined);
  await releaseBrowserLock?.();
  process.removeListener('SIGTERM', releaseOnSignal);
  process.removeListener('SIGINT', releaseOnSignal);
  await atomicJson(join(manifest.jobDir, 'events-summary.json'), summarizeEvents(events));
  await writeFile(join(manifest.jobDir, 'events.log'), redact(events), { mode: 0o600 });
  await writeFile(join(manifest.jobDir, 'stderr.log'), redact(stderr), { mode: 0o600 });
  let reason: string | undefined;
  if (timedOut) reason = `${dialect.label} job exceeded the ${manifest.timeoutMs}ms timeout`;
  else if (browserStepLimitExceeded)
    reason = `BrowserOS Neo exceeded the ${manifest.browserMaxSteps} step limit`;
  else if ('error' in exit) reason = exit.error.message;
  else if (result && 'error' in result) reason = result.error;
  else if (exit.code !== 0)
    reason = dialect.failureReason(
      events,
      stderr,
      `${dialect.label} exited with ${exit.code ?? exit.signal}`,
    );
  else if (dialect.result && !result) reason = `${dialect.label} finished without a result`;
  else if (result) await writeFile(manifest.resultPath, result.text, { mode: 0o600 });
  if (reason === undefined) {
    await atomicJson(statusPath, {
      state: 'succeeded',
      exitCode: 0,
      finishedAt: new Date().toISOString(),
    });
  } else {
    await atomicJson(statusPath, {
      state: 'failed',
      exitCode: exit.code,
      reason: redact(reason).slice(-4096),
      finishedAt: new Date().toISOString(),
    });
  }
}

/** One BrowserOS Neo session is shared by every CLI, so the lock lives in the
 * workspace root, above each CLI's jobs directory. */
async function acquireBrowserLock(manifest: CliRunnerManifest): Promise<() => Promise<void>> {
  const lockPath = join(dirname(dirname(manifest.jobDir)), 'browseros-neo.lock');
  const deadline = Date.now() + manifest.timeoutMs;
  while (Date.now() < deadline) {
    try {
      const handle = await open(lockPath, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, jobDir: manifest.jobDir }));
      await handle.close();
      return async () => unlink(lockPath).catch(() => undefined);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const lock = JSON.parse(await readFile(lockPath, 'utf8')) as { pid?: number };
        if (lock.pid) process.kill(lock.pid, 0);
      } catch (lockError) {
        if ((lockError as NodeJS.ErrnoException).code === 'ESRCH') {
          await unlink(lockPath).catch(() => undefined);
          continue;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error('BrowserOS Neo job waited too long for the shared browser session');
}

void main().catch(async (error) => {
  const manifestPath = process.argv[2];
  const jobDir = manifestPath ? dirname(manifestPath) : process.cwd();
  await atomicJson(join(jobDir, 'status.json'), {
    state: 'failed',
    reason: redact(error instanceof Error ? error.message : String(error)).slice(-4096),
    finishedAt: new Date().toISOString(),
  }).catch(() => undefined);
  process.exitCode = 1;
});

function summarizeEvents(events: string): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const line of events.split('\n')) {
    if (!line.trim()) continue;
    try {
      const type = String((JSON.parse(line) as { type?: unknown }).type ?? 'unknown');
      summary[type] = (summary[type] ?? 0) + 1;
    } catch {
      summary.malformed = (summary.malformed ?? 0) + 1;
    }
  }
  return summary;
}

function redact(text: string): string {
  return text
    .replace(/(bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password)["'=:\s]+)[^\s,"']+/gi, '$1[REDACTED]');
}
