// The side effects the updater needs from the container: commands, the s6
// supervisor, the API's health endpoint and disk space. Kept behind one
// object so the update logic can be tested without a container.
import { spawn } from 'node:child_process';
import { statfs } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

export function run(command, args, { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`));
    });
  });
}

export function createSystem({
  apiPort = process.env.API_PORT ?? '8080',
  serviceDir = '/run/service',
  s6Svc = '/command/s6-svc',
} = {}) {
  const api = `${serviceDir}/api`;
  return {
    run,
    restartApi: () => run(s6Svc, ['-r', api]),
    stopApi: () => run(s6Svc, ['-wD', '-T', '60000', '-d', api]),
    startApi: () => run(s6Svc, ['-u', api]),
    async health() {
      try {
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/system/health`, {
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    },
    async freeBytes(dir) {
      const stats = await statfs(dir);
      return stats.bavail * stats.bsize;
    },
    sleep,
    now: () => Date.now(),
  };
}
