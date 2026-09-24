import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface CodexLaunchInput {
  jobDir: string;
  manifestPath: string;
}

export class CodexJobLauncher {
  async launch(input: CodexLaunchInput): Promise<number> {
    const child = spawn(
      process.execPath,
      [join(__dirname, 'codex-job-runner.js'), input.manifestPath],
      {
        cwd: input.jobDir,
        detached: true,
        stdio: 'ignore',
        env: process.env,
      },
    );
    child.unref();
    if (!child.pid) throw new Error('Codex runner did not start');
    return child.pid;
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
      if (!pid) return false;
      process.kill(-pid, 'SIGTERM');
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ESRCH';
    }
  }
}
