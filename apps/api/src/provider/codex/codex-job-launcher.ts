import { spawn } from 'node:child_process';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';

export interface CodexLaunchInput {
  jobDir: string;
  manifestPath: string;
}

export class CodexJobLauncher {
  private readonly logger = new Logger(CodexJobLauncher.name);

  async launch(input: CodexLaunchInput): Promise<number> {
    const child = spawn(
      process.execPath,
      [join(__dirname, 'codex-job-runner.js'), input.manifestPath],
      {
        cwd: input.jobDir,
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        env: process.env,
      },
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + String(chunk)).slice(-4096);
    });
    // The runner writes its own "failed" status once it reaches `main()`
    // (codex-job-runner.ts's top-level catch). If node itself fails before
    // that — missing/stale dist file, module load error — status.json is
    // left at "queued" forever and the only symptom is the adapter's blind
    // 30s poll timeout ("Codex runner never started"). Surface it here
    // immediately instead, using whatever the process did print.
    child.once('error', (error) => {
      this.logger.error({ jobDir: input.jobDir, err: error }, 'codex runner spawn failed');
      void this.recordLaunchFailure(input.jobDir, `Codex runner failed to spawn: ${error.message}`);
    });
    // 'close' (not 'exit') — 'exit' can fire before the stdio pipes finish
    // flushing their last data, which would race the `stderr` accumulation
    // above and misreport "no output" for a process that did print one.
    child.once('close', (code, signal) => {
      if (code === 0 && !signal) {
        this.logger.debug({ jobDir: input.jobDir, pid: child.pid }, 'codex runner exited');
        return;
      }
      this.logger.error(
        { jobDir: input.jobDir, pid: child.pid, exitCode: code, signal },
        'codex runner exited abnormally',
      );
      void this.recordLaunchFailure(
        input.jobDir,
        `Codex runner exited before starting (code ${code ?? 'null'}, signal ${signal ?? 'null'}): ${
          stderr.trim() || 'no output'
        }`,
      );
    });
    child.unref();
    if (!child.pid) throw new Error('Codex runner did not start');
    this.logger.log({ jobDir: input.jobDir, pid: child.pid }, 'codex runner started');
    return child.pid;
  }

  private async recordLaunchFailure(jobDir: string, reason: string): Promise<void> {
    const statusPath = join(jobDir, 'status.json');
    try {
      const current = JSON.parse(await readFile(statusPath, 'utf8')) as { state?: string };
      // The runner already reported its own outcome — don't clobber it.
      if (current.state && current.state !== 'queued') return;
    } catch (error) {
      this.logger.warn({ jobDir, err: error }, 'codex status unreadable before launch failure');
    }
    const temp = `${statusPath}.${process.pid}.tmp`;
    await writeFile(
      temp,
      JSON.stringify({ state: 'failed', reason, finishedAt: new Date().toISOString() }),
      { mode: 0o600 },
    ).catch((error: unknown) =>
      this.logger.warn({ jobDir, err: error }, 'codex launch failure status write failed'),
    );
    await rename(temp, statusPath).catch((error: unknown) =>
      this.logger.warn({ jobDir, err: error }, 'codex launch failure status rename failed'),
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
        this.logger.warn({ jobDir }, 'codex cancel found no runner pid');
        return false;
      }
      process.kill(-pid, 'SIGTERM');
      this.logger.log({ jobDir, pid }, 'codex runner terminated');
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
      this.logger.warn({ jobDir, err: error }, 'codex runner cancel failed');
      return false;
    }
  }
}
