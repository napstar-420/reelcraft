import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { ConflictException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QwenTtsRuntime } from './qwen-runtime.service';
import { venvPython } from './qwen-runtime';

const URL = 'http://127.0.0.1:8091';

/** A child process that records what happens to it. */
class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  signals: string[] = [];
  closed = false;

  constructor(exitsWhenStdinCloses: boolean) {
    super();
    // The real service watches its stdin and exits when the app that started it goes away.
    if (exitsWhenStdinCloses) this.stdin.on('finish', () => setImmediate(() => this.exit(0)));
  }

  kill(signal = 'SIGTERM') {
    this.signals.push(signal);
    setImmediate(() => this.exit(null));
    return true;
  }

  exit(code: number | null) {
    if (this.closed) return;
    this.closed = true;
    this.emit('close', code);
  }
}

interface Call {
  command: string;
  args: string[];
  options: { env?: Record<string, string>; cwd?: string };
  child: FakeChild;
  isUv: boolean;
}

interface Options {
  source?: 'default' | 'saved';
  hasUv?: boolean;
  /** Take over a spawned process (return true), e.g. to make it hang or fail. */
  onSpawn?: (call: Call, world: World) => boolean | void;
  serviceIgnoresStdin?: boolean;
}

interface World {
  healthy: boolean;
  hasUv: boolean;
  nvidia: string | null;
  source: 'default' | 'saved';
  models: Array<{ state: string }>;
  clock: number;
}

const created: string[] = [];

function rig(options: Options = {}) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'qwen-home-'));
  const sourceDir = mkdtempSync(path.join(os.tmpdir(), 'qwen-src-'));
  created.push(home, sourceDir);
  writeFileSync(path.join(sourceDir, 'pyproject.toml'), '[project]\nname = "x"\n');
  writeFileSync(path.join(sourceDir, 'constraints.txt'), 'torch==1\n');
  const python = venvPython(home, 'linux');

  const world: World = {
    healthy: false,
    hasUv: options.hasUv ?? true,
    nvidia: null,
    source: options.source ?? 'default',
    models: [],
    clock: 1_000_000,
  };
  const calls: Call[] = [];
  const fetchCalls: string[] = [];

  const spawn = vi.fn((command: string, args: string[], spawnOptions: Call['options']) => {
    const isUv = /(^|\/)uv$/.test(command);
    const child = new FakeChild(!isUv && !options.serviceIgnoresStdin);
    const call: Call = { command, args, options: spawnOptions, child, isUv };
    calls.push(call);
    if (!isUv) child.on('close', () => (world.healthy = false));
    if (options.onSpawn?.(call, world) === true) return child as unknown as ChildProcess;
    if (isUv) {
      if (args[0] === 'venv') {
        mkdirSync(path.dirname(python), { recursive: true });
        writeFileSync(python, '');
      }
      setImmediate(() => {
        child.stderr.write('installing\n');
        child.exit(0);
      });
    } else {
      setTimeout(() => (world.healthy = true), 5);
    }
    return child as unknown as ChildProcess;
  });

  const execFile = vi.fn(async (command: string) => {
    if (command === 'nvidia-smi') {
      if (!world.nvidia) throw new Error('ENOENT');
      return { stdout: `${world.nvidia}\n`, stderr: '' };
    }
    if (!world.hasUv) throw new Error('ENOENT');
    return { stdout: 'uv 0.12.23 (Homebrew 2026-10-03)\n', stderr: '' };
  });

  const fetchMock = vi.fn(async (url: string) => {
    fetchCalls.push(url);
    if (url.endsWith('/health')) {
      return world.healthy
        ? {
            ok: true,
            json: async () => ({
              service: 'reelcraft-qwen-tts',
              device: 'mps',
              deviceLabel: 'Apple GPU (MPS)',
              reason: null,
              ready: true,
            }),
          }
        : { ok: false, json: async () => ({}) };
    }
    if (url.endsWith('/v1/models')) return { ok: true, json: async () => ({ data: world.models }) };
    return { ok: false, json: async () => ({}) };
  });

  const runtime = new QwenTtsRuntime(
    { qwenTtsHome: home, qwenTtsSourceDir: sourceDir },
    { qwenTts: async () => ({ url: URL, source: world.source }) },
    {
      spawn: spawn as never,
      execFile: execFile as never,
      fetch: fetchMock as never,
      now: () => world.clock,
      platform: 'linux',
      env: { PATH: '/bin', HOME: home, DATABASE_URL: 'postgres://u:secret@db/x' },
      homedir: home,
      inContainer: () => false,
      pollMs: 2,
      startTimeoutMs: 2_000,
      stopGraceMs: 30,
      idleMs: 10 * 60_000,
      idleCheckMs: 10,
    },
  );
  const pythons = () => calls.filter((c) => !c.isUv);
  const uvs = () => calls.filter((c) => c.isUv);
  return {
    runtime,
    world,
    calls,
    pythons,
    uvs,
    spawn,
    execFile,
    fetchMock,
    fetchCalls,
    home,
    sourceDir,
    python,
  };
}

const phase = async (r: ReturnType<typeof rig>) => (await r.runtime.status()).phase;
const waitForPhase = (r: ReturnType<typeof rig>, expected: string) =>
  vi.waitFor(async () => expect(await phase(r)).toBe(expected), { timeout: 3_000, interval: 5 });

/** Installs successfully, leaving the runtime stopped. */
async function installed(options: Options = {}) {
  const r = rig(options);
  await r.runtime.install('auto');
  await waitForPhase(r, 'stopped');
  return r;
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('construction', () => {
  it('starts nothing and asks nothing: the real app builds this in every test run', () => {
    const r = rig();
    expect(r.spawn).not.toHaveBeenCalled();
    expect(r.fetchMock).not.toHaveBeenCalled();
    expect(r.execFile).not.toHaveBeenCalled();
  });
});

describe('status before anything is installed', () => {
  it('says there is nothing to set up when this copy of Reelcraft has no service', async () => {
    const r = rig();
    rmSync(path.join(r.sourceDir, 'pyproject.toml'));
    const status = await r.runtime.status();
    expect(status.phase).toBe('unavailable');
    expect(status.error).toContain('no Qwen3-TTS service');
    await expect(r.runtime.ensureRunning()).rejects.toBeInstanceOf(ConflictException);
  });

  it('needs uv when it is missing, and finds it after Check again', async () => {
    const r = rig({ hasUv: false });
    expect((await r.runtime.status()).phase).toBe('needs-uv');
    r.world.hasUv = true;
    expect((await r.runtime.status()).phase).toBe('needs-uv'); // remembered until asked again
    const checked = await r.runtime.check();
    expect(checked.phase).toBe('not-installed');
    expect(checked.uv).toEqual({ path: 'uv', version: '0.12.23' });
  });

  it('reports the sizes the confirm dialog shows, larger when an NVIDIA GPU is found', async () => {
    const r = rig();
    const plain = await r.runtime.status();
    expect(plain.sizes.packagesBytes).toBe(1.2e9);
    expect(plain.sizes.freeBytes).toBeGreaterThan(0);
    r.world.nvidia = 'NVIDIA GeForce RTX 3060';
    const nvidia = await r.runtime.check();
    expect(nvidia.nvidiaGpu).toBe('NVIDIA GeForce RTX 3060');
    expect(nvidia.sizes).toMatchObject({ packagesBytes: 5e9, packagesEstimated: true });
  });

  it('refuses to start a service that was never installed, and says where to set it up', async () => {
    const r = rig();
    await expect(r.runtime.ensureRunning()).rejects.toThrow('Set up');
    expect(r.spawn).not.toHaveBeenCalled();
  });
});

describe('installing', () => {
  it('creates the environment, installs the engine, and remembers it', async () => {
    const r = await installed();
    const [venv, pip] = r.uvs();
    expect(venv!.args).toEqual(['venv', path.join(r.home, 'venv'), '--python', '3.12']);
    expect(pip!.args).toEqual([
      'pip',
      'install',
      '--python',
      r.python,
      '--torch-backend',
      'auto',
      '-r',
      path.join(r.sourceDir, 'pyproject.toml'),
      '--extra',
      'engine',
      '-c',
      path.join(r.sourceDir, 'constraints.txt'),
    ]);
    expect(existsSync(path.join(r.home, 'state.json'))).toBe(true);
    expect((await r.runtime.status()).log).toContain('installing');
  });

  it('runs uv with an allowlisted environment, never the database password', async () => {
    const r = await installed();
    for (const call of r.uvs()) {
      expect(call.options.env).toMatchObject({ PATH: '/bin', NO_COLOR: '1' });
      expect(JSON.stringify(call.options.env)).not.toContain('secret');
    }
  });

  it('shows the error and offers a retry on the CPU when the install fails', async () => {
    const r = rig({
      onSpawn: (call) => {
        if (call.isUv && call.args[0] === 'pip') {
          call.child.stderr.write('error: no matching distribution for torch\n');
          setImmediate(() => call.child.exit(2));
          return true;
        }
      },
    });
    await r.runtime.install('auto');
    await waitForPhase(r, 'install-failed');
    expect((await r.runtime.status()).error).toBe('error: no matching distribution for torch');

    r.calls.length = 0;
    await r.runtime.install('cpu'); // clears the failure and starts again
    expect(r.uvs()).toHaveLength(1); // the venv step is under way
    await vi.waitFor(() => expect(r.uvs().some((c) => c.args.includes('cpu'))).toBe(true));
  });

  it('can be cancelled, and goes back to not installed without an error', async () => {
    const r = rig({
      onSpawn: (call) => {
        if (call.isUv && call.args[0] === 'pip') return true; // hangs until killed
      },
    });
    await r.runtime.install('auto');
    await waitForPhase(r, 'installing');
    r.runtime.cancelInstall();
    await waitForPhase(r, 'not-installed');
    const status = await r.runtime.status();
    expect(status.error).toBeNull();
    expect(status.log).toContain('Cancelled');
  });

  it('will not start a second install, or one under a service the user runs themselves', async () => {
    const r = rig({
      onSpawn: (call) => {
        if (call.isUv) return true; // hangs
      },
    });
    await r.runtime.install('auto');
    await expect(r.runtime.install('auto')).rejects.toBeInstanceOf(ConflictException);

    const external = rig({ source: 'saved' });
    await expect(external.runtime.install('auto')).rejects.toThrow('service you run yourself');
    expect(external.spawn).not.toHaveBeenCalled();
  });

  it('needs uv to install', async () => {
    const r = rig({ hasUv: false });
    await expect(r.runtime.install('auto')).rejects.toThrow('uv is not installed');
  });

  it('is out of date when the pinned packages change, and still starts', async () => {
    const r = await installed();
    writeFileSync(path.join(r.sourceDir, 'constraints.txt'), 'torch==2\n');
    expect(await phase(r)).toBe('outdated');
    await expect(r.runtime.ensureRunning()).resolves.toBe(URL);
  });
});

describe('starting', () => {
  it('starts the service from source with only what it needs, and waits until it answers', async () => {
    const r = await installed();
    await expect(r.runtime.ensureRunning()).resolves.toBe(URL);
    const [call] = r.pythons();
    expect(call!.command).toBe(r.python);
    expect(call!.args).toEqual(['-m', 'qwen_tts_service']);
    expect(call!.options.cwd).toBe(r.sourceDir);
    expect(call!.options.env).toMatchObject({
      PYTHONPATH: path.join(r.sourceDir, 'src'),
      QWEN_TTS_MODELS_DIR: path.join(r.home, 'models'),
      QWEN_TTS_PORT: '8091',
      QWEN_TTS_EXIT_WITH_STDIN: '1',
    });
    expect(JSON.stringify(call!.options.env)).not.toContain('secret');
    const status = await r.runtime.status();
    expect(status).toMatchObject({
      phase: 'running',
      owned: true,
      device: 'mps',
      deviceLabel: 'Apple GPU (MPS)',
    });
  });

  it('starts it once however many requests arrive together', async () => {
    const r = await installed();
    await Promise.all([
      r.runtime.ensureRunning(),
      r.runtime.ensureRunning(),
      r.runtime.use(async () => 1),
    ]);
    expect(r.pythons()).toHaveLength(1);
  });

  it('uses a service the user already started, and leaves it alone', async () => {
    const r = rig();
    r.world.healthy = true;
    await expect(r.runtime.ensureRunning()).resolves.toBe(URL);
    expect(r.spawn).not.toHaveBeenCalled();
    const status = await r.runtime.status();
    expect(status).toMatchObject({ phase: 'running', owned: false });
    await expect(r.runtime.stop()).rejects.toThrow('started outside Reelcraft');
  });

  it('reports a service that dies on startup, with the last line it printed', async () => {
    const r = await installed();
    r.spawn.mockImplementationOnce(((command: string, args: string[], options: Call['options']) => {
      const child = new FakeChild(false);
      r.calls.push({ command, args, options, child, isUv: false });
      child.stderr.write('ImportError: libtorch is broken\n');
      setImmediate(() => child.exit(1));
      return child as unknown as ChildProcess;
    }) as never);
    await expect(r.runtime.ensureRunning()).rejects.toThrow('ImportError: libtorch is broken');
    const status = await r.runtime.status();
    expect(status).toMatchObject({ phase: 'failed', error: 'ImportError: libtorch is broken' });
  });

  it('tries again on the next use after a crash, once, with no restart loop', async () => {
    const r = await installed();
    await r.runtime.ensureRunning();
    const first = r.pythons()[0]!.child;
    first.stderr.write('Segmentation fault\n');
    first.exit(139);
    await waitForPhase(r, 'failed');
    expect(r.pythons()).toHaveLength(1); // nothing restarted it behind our back
    await r.runtime.ensureRunning();
    expect(r.pythons()).toHaveLength(2);
    expect(await phase(r)).toBe('running');
  });

  it('never starts anything when the user runs the service themselves', async () => {
    const r = rig({ source: 'saved' });
    r.world.healthy = true;
    await expect(r.runtime.ensureRunning()).resolves.toBe(URL);
    expect(r.spawn).not.toHaveBeenCalled();
    expect(await phase(r)).toBe('running');
    r.world.healthy = false;
    const status = await r.runtime.status();
    expect(status).toMatchObject({ mode: 'external', phase: 'stopped' });
    expect(status.error).toContain(URL);
  });
});

describe('stopping', () => {
  it('closes the pipe the service watches, and waits for it to exit', async () => {
    const r = await installed();
    await r.runtime.ensureRunning();
    const child = r.pythons()[0]!.child;
    await r.runtime.stop();
    expect(child.stdin.writableEnded).toBe(true);
    expect(child.signals).toEqual([]); // it left on its own
    expect(await phase(r)).toBe('stopped');
  });

  it('kills a service that does not leave after a few seconds', async () => {
    const r = await installed({ serviceIgnoresStdin: true });
    await r.runtime.ensureRunning();
    const child = r.pythons()[0]!.child;
    await r.runtime.stop();
    expect(child.signals).toEqual(['SIGKILL']);
    expect(await phase(r)).toBe('stopped');
  });

  it('ends the service and an install when the API shuts down', async () => {
    const r = await installed();
    await r.runtime.ensureRunning();
    const child = r.pythons()[0]!.child;
    r.runtime.onModuleDestroy();
    expect(child.stdin.writableEnded).toBe(true);
    expect(child.signals).toEqual(['SIGTERM']);
  });
});

describe('stopping when idle', () => {
  const minutes = (n: number) => n * 60_000;

  it('stops a service nobody has used for ten minutes, and starts it again for the next request', async () => {
    const r = await installed();
    await r.runtime.use(async () => 'speech');
    r.world.clock += minutes(11);
    await waitForPhase(r, 'stopped');
    expect(r.pythons()[0]!.child.closed).toBe(true);
    await r.runtime.use(async () => 'more speech');
    expect(r.pythons()).toHaveLength(2);
    expect(await phase(r)).toBe('running');
  });

  it('leaves it running while it is used, and under a request in flight', async () => {
    const r = await installed();
    let finish!: () => void;
    const request = r.runtime.use(() => new Promise<void>((resolve) => (finish = resolve)));
    await vi.waitFor(() => expect(r.pythons()).toHaveLength(1));
    await vi.waitFor(async () => expect(await phase(r)).toBe('running'));
    r.world.clock += minutes(30);
    await new Promise((resolve) => setTimeout(resolve, 80)); // several idle checks
    expect(await phase(r)).toBe('running');
    finish();
    await request;
    r.world.clock += minutes(11);
    await waitForPhase(r, 'stopped');
  });

  it('is not idle while a model is downloading', async () => {
    const r = await installed();
    await r.runtime.use(async () => 'speech');
    r.world.models = [{ state: 'downloading' }];
    r.world.clock += minutes(30);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(await phase(r)).toBe('running');
    r.world.models = [{ state: 'ready' }];
    await waitForPhase(r, 'stopped');
  });

  it('never stops a service the user started', async () => {
    const r = rig();
    r.world.healthy = true;
    await r.runtime.use(async () => 'speech');
    r.world.clock += minutes(60);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(r.spawn).not.toHaveBeenCalled();
    expect(await phase(r)).toBe('running');
  });
});

describe('what listing does', () => {
  it('asking for the status never starts the service', async () => {
    const r = await installed();
    r.calls.length = 0;
    await r.runtime.status();
    await r.runtime.status();
    expect(r.pythons()).toHaveLength(0);
    expect(await phase(r)).toBe('stopped');
  });
});

describe('models that were ready', () => {
  it('remembers them once installed, for the UI to show while the service is stopped', async () => {
    const r = rig();
    r.runtime.rememberReadyModels(['m']); // nothing installed yet: nothing to write into
    expect(r.runtime.readyModels()).toEqual([]);

    const installedRig = await installed();
    installedRig.runtime.rememberReadyModels(['Qwen/a', 'Qwen/b']);
    expect(installedRig.runtime.readyModels()).toEqual(['Qwen/a', 'Qwen/b']);
  });

  it('keeps them across a reinstall', async () => {
    const r = await installed();
    r.runtime.rememberReadyModels(['Qwen/a']);
    await r.runtime.install('cpu');
    await waitForPhase(r, 'stopped');
    expect(r.runtime.readyModels()).toEqual(['Qwen/a']);
  });
});
