import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CliJobLauncher } from './cli-job-launcher';

describe('CliJobLauncher launch failures', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  // From src there is no compiled runner, so node exits abnormally and the launcher records it.
  async function statusAfterRunnerExit(initial: object) {
    dir = await mkdtemp(join(tmpdir(), 'cli-launcher-'));
    const statusPath = join(dir, 'status.json');
    await writeFile(statusPath, JSON.stringify(initial));
    await new CliJobLauncher().launch({ jobDir: dir, manifestPath: join(dir, 'missing.json') });
    for (let i = 0; i < 100; i++) {
      const status = JSON.parse(await readFile(statusPath, 'utf8')) as { state: string };
      if (status.state === 'failed') return status;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return JSON.parse(await readFile(statusPath, 'utf8')) as { state: string };
  }

  it('marks a plain queued job failed when its runner exits before starting', async () => {
    const status = await statusAfterRunnerExit({ state: 'queued' });
    expect(status.state).toBe('failed');
  });

  it('leaves a job waiting for the browser lock queued so the adapter can retry it', async () => {
    const initial = { state: 'queued', pid: 1, waitingForLock: true };
    dir = await mkdtemp(join(tmpdir(), 'cli-launcher-'));
    const statusPath = join(dir, 'status.json');
    await writeFile(statusPath, JSON.stringify(initial));
    await new CliJobLauncher().launch({ jobDir: dir, manifestPath: join(dir, 'missing.json') });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(JSON.parse(await readFile(statusPath, 'utf8'))).toEqual(initial);
  });
});

describe('CliJobLauncher process tree', () => {
  it('starts the runner outside the API process tree, so a watch reload cannot kill it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cli-launcher-'));
    const runner = join(dir, 'runner.js');
    const parentPath = join(dir, 'parent.txt');
    await writeFile(
      runner,
      `require('node:fs').writeFileSync(${JSON.stringify(parentPath)}, String(process.ppid)); setTimeout(() => {}, 60_000);`,
    );
    await writeFile(join(dir, 'status.json'), JSON.stringify({ state: 'running' }));
    const launcher = Object.assign(new CliJobLauncher(), { runnerPath: runner });
    const pid = await launcher.launch({ jobDir: dir, manifestPath: 'm.json' });
    try {
      let parent = '';
      for (let i = 0; i < 100 && !parent; i++) {
        parent = await readFile(parentPath, 'utf8').catch(() => '');
        if (!parent) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(Number(parent)).toBeGreaterThan(0);
      expect(Number(parent)).not.toBe(process.pid);
      expect(() => process.kill(pid, 0)).not.toThrow();
    } finally {
      process.kill(pid, 'SIGKILL');
      await rm(dir, { recursive: true, force: true });
    }
  });
});
