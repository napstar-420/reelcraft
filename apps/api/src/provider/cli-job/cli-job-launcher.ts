import { spawn } from 'node:child_process';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';

export interface CliLaunchInput {
  jobDir: string;
  manifestPath: string;
}

/** Runs as `node -e`: starts the runner detached, its stderr to a file, prints its pid, exits. */
const LAUNCH_SCRIPT = `
const { spawn } = require('node:child_process');
const { openSync } = require('node:fs');
const [runner, manifest, log] = process.argv.slice(1);
const child = spawn(process.execPath, [runner, manifest], {
  detached: true,
  stdio: ['ignore', 'ignore', openSync(log, 'a')],
});
child.unref();
process.stdout.write(String(child.pid));
`;
const START_WATCH_MS = 250;
/** 30 seconds: the runner marks itself running at once, or waits for the browser lock queued. */
const START_WATCH_POLLS = 120;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export class CliJobLauncher {
  private readonly logger = new Logger(CliJobLauncher.name);

  /** The compiled runner (a test points it at a stand-in). */
  runnerPath = join(__dirname, 'cli-job-runner.js');

  async launch(input: CliLaunchInput): Promise<number> {
    const stderrPath = join(input.jobDir, 'runner-stderr.log');
    // A go-between that starts the runner and exits at once, so the runner has no parent in the
    // API's process tree: `nest start --watch` kills that whole tree on every reload (tree-kill),
    // detached or not, which would end a job meant to outlive an API restart.
    const child = spawn(
      process.execPath,
      ['-e', LAUNCH_SCRIPT, this.runnerPath, input.manifestPath, stderrPath],
      { cwd: input.jobDir, stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr = (stderr + String(chunk)).slice(-4096)));
    const code = await new Promise<number | null>((resolve) => {
      child.once('error', (error) => {
        stderr = error.message;
        resolve(null);
      });
      // 'close' (not 'exit'): the pid on stdout is flushed by then
      child.once('close', resolve);
    });
    const pid = Number(stdout.trim());
    if (code !== 0 || !pid) {
      const reason = `CLI runner failed to spawn: ${stderr.trim() || `exit code ${code ?? 'null'}`}`;
      this.logger.error({ jobDir: input.jobDir, reason }, 'cli runner spawn failed');
      await this.recordLaunchFailure(input.jobDir, reason);
      throw new Error(reason);
    }
    this.logger.log({ jobDir: input.jobDir, pid }, 'cli runner started');
    void this.watchStart(input.jobDir, pid, stderrPath);
    return pid;
  }

  /**
   * The runner writes its own "failed" status once it reaches `main()` (cli-job-runner.ts's
   * top-level catch). If node itself fails before that (a missing or stale dist file, a module
   * load error), status.json would stay "queued" until the adapter's blind poll timeout. Watch
   * the runner until it reports, and record that early exit with what it printed.
   */
  private async watchStart(jobDir: string, pid: number, stderrPath: string): Promise<void> {
    for (let i = 0; i < START_WATCH_POLLS; i++) {
      await new Promise((resolve) => setTimeout(resolve, START_WATCH_MS).unref());
      const status = await readFile(join(jobDir, 'status.json'), 'utf8')
        .then((text) => JSON.parse(text) as { state?: string })
        .catch(() => null);
      if (status?.state && status.state !== 'queued') return;
      if (alive(pid)) continue;
      const printed = await readFile(stderrPath, 'utf8').catch(() => '');
      this.logger.error({ jobDir, pid }, 'cli runner exited before starting');
      await this.recordLaunchFailure(
        jobDir,
        `CLI runner exited before starting: ${printed.trim().slice(-4096) || 'no output'}`,
      );
      return;
    }
  }

  private async recordLaunchFailure(jobDir: string, reason: string): Promise<void> {
    const statusPath = join(jobDir, 'status.json');
    try {
      const current = JSON.parse(await readFile(statusPath, 'utf8')) as {
        state?: string;
        waitingForLock?: boolean;
      };
      // The runner already reported its own outcome — don't clobber it.
      if (current.state && current.state !== 'queued') return;
      // Killed while waiting for the browser lock: leave it queued so the adapter sees the dead
      // pid and reports a retryable infrastructure failure.
      if (current.waitingForLock) return;
    } catch (error) {
      this.logger.warn({ jobDir, err: error }, 'cli job status unreadable before launch failure');
    }
    const temp = `${statusPath}.${process.pid}.tmp`;
    await writeFile(
      temp,
      JSON.stringify({ state: 'failed', reason, finishedAt: new Date().toISOString() }),
      { mode: 0o600 },
    ).catch((error: unknown) =>
      this.logger.warn({ jobDir, err: error }, 'cli launch failure status write failed'),
    );
    await rename(temp, statusPath).catch((error: unknown) =>
      this.logger.warn({ jobDir, err: error }, 'cli launch failure status rename failed'),
    );
  }

  async cancel(jobDir: string): Promise<boolean> {
    try {
      const status = JSON.parse(await readFile(join(jobDir, 'status.json'), 'utf8')) as {
        pid?: number;
      };
      let pid = status.pid;
      if (!pid) {
        const processInfo = JSON.parse(await readFile(join(jobDir, 'process.json'), 'utf8')) as {
          pid?: number;
        };
        pid = processInfo.pid;
      }
      if (!pid) {
        this.logger.warn({ jobDir }, 'cli cancel found no runner pid');
        return false;
      }
      process.kill(-pid, 'SIGTERM');
      this.logger.log({ jobDir, pid }, 'cli runner terminated');
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
      this.logger.warn({ jobDir, err: error }, 'cli runner cancel failed');
      return false;
    }
  }
}
