import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function writeStatus(jobDir: string, status: unknown) {
  const temporary = path.join(jobDir, `status.${process.pid}.tmp`);
  await writeFile(temporary, JSON.stringify(status));
  await rename(temporary, path.join(jobDir, 'status.json'));
}

async function main() {
  const [jobDir, command, encodedArgs, maxWait] = process.argv.slice(2);
  if (!jobDir || !command || !encodedArgs || !maxWait) process.exit(2);
  const args = JSON.parse(encodedArgs) as string[];
  await writeStatus(jobDir, {
    done: false,
    phase: 'running',
    pid: process.pid,
    updatedAt: new Date().toISOString(),
  });
  const child = spawn(command, args, {
    cwd: jobDir,
    detached: true,
    stdio: [
      'ignore',
      openSync(path.join(jobDir, 'stdout.log'), 'a'),
      openSync(path.join(jobDir, 'stderr.log'), 'a'),
    ],
  });
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      try {
        process.kill(process.platform === 'win32' ? child.pid! : -child.pid!, 'SIGTERM');
      } catch {
        // Child already exited.
      }
    },
    Number(maxWait) * 1000,
  );
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  }).catch(async (error: unknown) => {
    await writeStatus(jobDir, {
      done: true,
      outcome: 'failed',
      reason: error instanceof Error ? error.message : String(error),
      completedAt: new Date().toISOString(),
    });
    return null;
  });
  clearTimeout(timer);
  await writeStatus(jobDir, {
    done: true,
    outcome: exitCode === 0 && !timedOut ? 'succeeded' : 'failed',
    exitCode,
    ...(exitCode === 0 && !timedOut
      ? {}
      : {
          reason: timedOut ? 'compute command timed out' : `command exited with code ${exitCode}`,
        }),
    completedAt: new Date().toISOString(),
  });
}

void main().catch(async (error: unknown) => {
  const jobDir = process.argv[2];
  if (jobDir) {
    await writeStatus(jobDir, {
      done: true,
      outcome: 'failed',
      reason: error instanceof Error ? error.message : String(error),
      completedAt: new Date().toISOString(),
    }).catch(() => undefined);
  }
  process.exitCode = 1;
});
