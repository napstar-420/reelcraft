import { spawn } from 'node:child_process';
import { open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildCodexArgs } from './codex-command';

interface Manifest {
  modelId: string;
  reasoningEffort: string;
  jobDir: string;
  resultPath: string;
  outputSchemaPath?: string;
  modality: 'text' | 'image' | 'browser';
  profile: string;
  timeoutMs: number;
  browserMaxSteps: number;
  params: Record<string, unknown>;
  prompt: string;
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  await rename(temp, path);
}

function appendBounded(current: string, chunk: unknown, limit: number): string {
  const next = current + String(chunk);
  return next.length <= limit ? next : next.slice(-limit);
}

async function main(): Promise<void> {
  const manifestPath = process.argv[2];
  if (!manifestPath) throw new Error('Codex runner requires a manifest path');
  const manifestJson = await readFile(manifestPath, 'utf8');
  await unlink(manifestPath);
  const manifest = JSON.parse(manifestJson) as Manifest;
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
  const child = spawn('codex', buildCodexArgs(manifest), {
    cwd: manifest.jobDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });
  let events = '';
  let stderr = '';
  let eventBuffer = '';
  let browserSteps = 0;
  let browserStepLimitExceeded = false;
  child.stdout.on('data', (chunk) => {
    events = appendBounded(events, chunk, 1024 * 1024);
    eventBuffer += String(chunk);
    const lines = eventBuffer.split('\n');
    eventBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (
        manifest.modality === 'browser' &&
        /browseros-neo/i.test(line) &&
        /(mcp_tool_call|tool_call|tool\.started)/i.test(line)
      ) {
        browserSteps += 1;
        if (browserSteps > manifest.browserMaxSteps) {
          browserStepLimitExceeded = true;
          child.kill('SIGTERM');
        }
      }
    }
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
      child.once('exit', (code, signal) => resolve({ code, signal }));
    },
  ).catch((error: Error) => ({ code: -1, signal: null, error }));
  clearTimeout(timeout);
  await releaseBrowserLock?.();
  process.removeListener('SIGTERM', releaseOnSignal);
  process.removeListener('SIGINT', releaseOnSignal);
  await atomicJson(join(manifest.jobDir, 'events-summary.json'), summarizeEvents(events));
  await writeFile(join(manifest.jobDir, 'stderr.log'), redact(stderr), { mode: 0o600 });
  if (exit.code === 0) {
    await atomicJson(statusPath, {
      state: 'succeeded',
      exitCode: 0,
      finishedAt: new Date().toISOString(),
    });
  } else {
    const reason = timedOut
      ? `Codex job exceeded the ${manifest.timeoutMs}ms timeout`
      : browserStepLimitExceeded
        ? `BrowserOS Neo exceeded the ${manifest.browserMaxSteps} step limit`
        : 'error' in exit
          ? exit.error.message
          : `Codex exited with ${exit.code ?? exit.signal}`;
    await atomicJson(statusPath, {
      state: 'failed',
      exitCode: exit.code,
      reason,
      finishedAt: new Date().toISOString(),
    });
  }
}

async function acquireBrowserLock(manifest: Manifest): Promise<() => Promise<void>> {
  const lockPath = join(dirname(manifest.jobDir), 'browseros-neo.lock');
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
    reason: error instanceof Error ? error.message : String(error),
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
