import {
  execFile as nodeExecFile,
  spawn as nodeSpawn,
  type ChildProcess,
  type SpawnOptions,
} from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  BadGatewayException,
  ConflictException,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { QwenTtsBackend, QwenTtsSetupDto, QwenTtsSetupPhase } from '@reelcraft/shared';
import type { EngineConfig } from '../../config/engine-config';
import type { SettingsService } from '../../settings/settings.service';
import {
  appendLog,
  DISK_MARGIN_BYTES,
  fingerprint,
  HEALTH_POLL_MS,
  IDLE_STOP_MS,
  installArgs,
  installEnv,
  lastLine,
  packageSize,
  portOf,
  SERVICE_ID,
  serviceEnv,
  START_TIMEOUT_MS,
  STOP_GRACE_MS,
  uvCandidates,
  venvArgs,
  venvPython,
} from './qwen-runtime';

const execFileAsync = promisify(nodeExecFile);

type Spawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;
type Exec = (
  command: string,
  args: string[],
  options: { timeout: number },
) => Promise<{ stdout: string; stderr: string }>;
type Fetch = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** Everything the runtime touches outside itself, so tests can replace it. */
export interface RuntimeDeps {
  spawn?: Spawn;
  execFile?: Exec;
  fetch?: Fetch;
  now?: () => number;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
  inContainer?: () => boolean;
  pollMs?: number;
  startTimeoutMs?: number;
  stopGraceMs?: number;
  idleMs?: number;
  idleCheckMs?: number;
}

/** What `state.json` remembers about an install. */
interface InstallState {
  fingerprint: string;
  backend: QwenTtsBackend;
  installedAt: string;
  uvVersion: string;
  /** Models that were ready the last time the service answered, so the UI can say so while it is stopped. */
  readyModels: string[];
}

type Health = {
  service?: string;
  device?: string | null;
  deviceLabel?: string | null;
  reason?: string | null;
  ready?: boolean;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Installs, starts and stops the local Qwen3-TTS service for the user, so a new user needs no terminal.
 *
 * - **Managed** (no address saved in Settings or `QWEN_TTS_URL`): this class creates a virtual
 *   environment with `uv`, installs the service's packages into it (the PyTorch build for this
 *   computer's GPU, else the CPU's), and runs the service as a child process.
 * - **External** (an address is saved): the user runs the service; this class never installs or
 *   spawns anything.
 *
 * It starts the service only when something needs it (`use`), and stops it again after
 * `IDLE_STOP_MS` of no use, so it only runs while it is used. The service exits when this process
 * does (it watches its stdin), so it is never left behind. Nothing here runs at construction.
 */
export class QwenTtsRuntime implements OnModuleDestroy {
  private readonly logger = new Logger(QwenTtsRuntime.name);
  private readonly d: Required<RuntimeDeps>;

  private busy: 'installing' | 'starting' | 'stopping' | null = null;
  private failure: { phase: 'install-failed' | 'failed'; error: string } | null = null;
  private child: ChildProcess | null = null;
  private installChild: ChildProcess | null = null;
  private cancelling = false;
  private pending: Promise<void> | null = null;
  private log = '';
  private startedAt: string | null = null;
  private inflight = 0;
  private lastUsed = 0;
  private idleTimer: NodeJS.Timeout | null = null;
  /** The running service was started by someone else (the user ran `pnpm tts`). */
  private adopted = false;
  // Looked up on first use and kept until "Check again".
  private uv: { path: string; version: string } | null | undefined;
  private nvidia: string | null | undefined;

  constructor(
    private readonly config: Pick<EngineConfig, 'qwenTtsHome' | 'qwenTtsSourceDir'>,
    private readonly settings: Pick<SettingsService, 'qwenTts'>,
    deps: RuntimeDeps = {},
  ) {
    this.d = {
      spawn: deps.spawn ?? ((command, args, options) => nodeSpawn(command, args, options)),
      execFile:
        deps.execFile ?? ((command, args, options) => execFileAsync(command, args, options)),
      fetch: deps.fetch ?? ((url, init) => fetch(url, init)),
      now: deps.now ?? Date.now,
      platform: deps.platform ?? process.platform,
      env: deps.env ?? process.env,
      homedir: deps.homedir ?? os.homedir(),
      inContainer: deps.inContainer ?? (() => existsSync('/.dockerenv')),
      pollMs: deps.pollMs ?? HEALTH_POLL_MS,
      startTimeoutMs: deps.startTimeoutMs ?? START_TIMEOUT_MS,
      stopGraceMs: deps.stopGraceMs ?? STOP_GRACE_MS,
      idleMs: deps.idleMs ?? IDLE_STOP_MS,
      idleCheckMs: deps.idleCheckMs ?? 60_000,
    };
  }

  onModuleDestroy(): void {
    this.clearIdle();
    this.installChild?.kill();
    // Closing stdin makes the service exit; the kill covers a service that is still importing PyTorch.
    this.child?.stdin?.end();
    this.child?.kill();
  }

  // -- Status ---------------------------------------------------------------------------------

  async status(): Promise<QwenTtsSetupDto> {
    const { managed, url } = await this.mode();
    const home = this.config.qwenTtsHome;
    const nvidiaGpu = await this.detectNvidia();
    const size = packageSize(this.d.platform, nvidiaGpu);
    const base: QwenTtsSetupDto = {
      mode: managed ? 'managed' : 'external',
      phase: 'stopped',
      error: null,
      owned: false,
      device: null,
      deviceLabel: null,
      deviceReason: null,
      uv: null,
      nvidiaGpu,
      inContainer: this.d.inContainer(),
      homeDir: home,
      sizes: {
        packagesBytes: size.bytes,
        packagesEstimated: size.estimated,
        freeBytes: this.freeBytes(home),
      },
      log: this.log,
      startedAt: this.startedAt,
    };
    const withDevice = (health: Health | null): Partial<QwenTtsSetupDto> => ({
      device: health?.device ?? null,
      deviceLabel: health?.deviceLabel ?? null,
      deviceReason: health?.reason ?? null,
    });

    if (!managed) {
      const health = await this.health(url);
      return health
        ? { ...base, phase: 'running', ...withDevice(health) }
        : { ...base, phase: 'stopped', error: `Can't reach the service at ${url}.` };
    }

    const sourceDir = this.sourceDir();
    if (!sourceDir) {
      return {
        ...base,
        phase: 'unavailable',
        error:
          'This copy of Reelcraft has no Qwen3-TTS service to set up. Run one yourself (see the guide) and save its address.',
      };
    }
    const uv = await this.resolveUv();
    const phase = await this.phase(url, sourceDir, uv !== null);
    const running = phase.phase === 'running';
    return {
      ...base,
      uv,
      ...phase,
      owned: running && !this.adopted,
      ...(running ? withDevice(await this.health(url)) : {}),
    };
  }

  /** The phase, from what is in memory first and what is on disk after. */
  private async phase(
    url: string,
    sourceDir: string,
    hasUv: boolean,
  ): Promise<{ phase: QwenTtsSetupPhase; error: string | null }> {
    if (this.busy) return { phase: this.busy, error: null };
    if (this.failure) return { phase: this.failure.phase, error: this.failure.error };
    if (this.child) return { phase: 'running', error: null };
    if (await this.health(url)) {
      this.adopted = true;
      return { phase: 'running', error: null };
    }
    const installed = this.installState(sourceDir);
    if (installed === 'installed') return { phase: 'stopped', error: null };
    if (!hasUv) {
      return {
        phase: 'needs-uv',
        error: 'uv, which installs the packages, was not found on this computer.',
      };
    }
    return { phase: installed === 'outdated' ? 'outdated' : 'not-installed', error: null };
  }

  // -- Install --------------------------------------------------------------------------------

  /** Starts installing (or reinstalling) and returns at once; progress is in `status()`. */
  async install(backend: QwenTtsBackend): Promise<void> {
    const { managed } = await this.mode();
    if (!managed) {
      throw new ConflictException(
        'Reelcraft is using a Qwen3-TTS service you run yourself. Reset its address in Settings to let Reelcraft install one.',
      );
    }
    const sourceDir = this.requireSource();
    if (this.busy) throw new ConflictException(`Qwen3-TTS is ${this.busy} right now.`);
    const uv = await this.resolveUv();
    if (!uv) {
      throw new ConflictException('uv is not installed. Install it, then select Check again.');
    }
    const size = packageSize(this.d.platform, await this.detectNvidia());
    const free = this.freeBytes(this.config.qwenTtsHome);
    if (free !== null && free < size.bytes + DISK_MARGIN_BYTES) {
      throw new ConflictException(
        `Not enough disk space: about ${gb(size.bytes)} GB needed, ${gb(free)} GB free.`,
      );
    }
    await this.stopOwned(); // a reinstall replaces the packages under a running service
    this.busy = 'installing';
    this.failure = null;
    this.log = '';
    this.cancelling = false;
    this.startedAt = new Date(this.d.now()).toISOString();
    void this.runInstall(uv, sourceDir, backend);
  }

  cancelInstall(): void {
    if (this.busy !== 'installing' || !this.installChild) return;
    this.cancelling = true;
    this.installChild.kill();
  }

  private async runInstall(
    uv: { path: string; version: string },
    sourceDir: string,
    backend: QwenTtsBackend,
  ): Promise<void> {
    const home = this.config.qwenTtsHome;
    const venvDir = path.join(home, 'venv');
    const previous = this.readState();
    try {
      rmSync(venvDir, { recursive: true, force: true });
      mkdirSync(home, { recursive: true });
      let code = await this.step(uv.path, venvArgs(venvDir), sourceDir);
      if (code === 0) {
        const python = venvPython(home, this.d.platform);
        code = await this.step(uv.path, installArgs({ python, sourceDir, backend }), sourceDir);
      }
      if (this.cancelling) {
        this.log = appendLog(this.log, '\nCancelled.\n');
        rmSync(venvDir, { recursive: true, force: true });
      } else if (code !== 0) {
        this.failure = {
          phase: 'install-failed',
          error: lastLine(this.log) ?? `uv exited with code ${code}.`,
        };
      } else {
        this.writeState({
          fingerprint: this.fingerprintOf(sourceDir, backend) ?? '',
          backend,
          installedAt: new Date(this.d.now()).toISOString(),
          uvVersion: uv.version,
          readyModels: previous?.readyModels ?? [],
        });
      }
    } catch (error) {
      this.failure = { phase: 'install-failed', error: (error as Error).message };
    } finally {
      this.busy = null;
      this.installChild = null;
    }
  }

  private step(command: string, args: string[], cwd: string): Promise<number> {
    // A cancel that arrives between two steps must stop the next one from ever starting.
    if (this.cancelling) return Promise.resolve(1);
    return new Promise((resolve) => {
      this.log = appendLog(this.log, `$ ${path.basename(command)} ${args.join(' ')}\n`);
      const child = this.d.spawn(command, args, {
        cwd,
        env: installEnv(this.d.env),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.installChild = child;
      const onData = (chunk: unknown) => (this.log = appendLog(this.log, String(chunk)));
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.once('error', (error) => {
        this.log = appendLog(this.log, `${error.message}\n`);
        resolve(127);
      });
      child.once('close', (code) => resolve(code ?? 1));
    });
  }

  // -- Running --------------------------------------------------------------------------------

  /**
   * Runs `work` against the service, starting it first if it is installed but stopped. Counts the
   * request as in flight, so the idle stop never fires under it. Listing models or voices must NOT
   * use this: the UI polls those, and polling would keep a service nobody is using alive.
   */
  async use<T>(work: (baseUrl: string) => Promise<T>): Promise<T> {
    this.inflight++;
    try {
      return await work(await this.ensureRunning());
    } finally {
      this.inflight--;
      this.lastUsed = this.d.now();
    }
  }

  /** Makes sure a service is answering and returns its address. */
  async ensureRunning(): Promise<string> {
    const { managed, url } = await this.mode();
    if (!managed) return url;
    // Callers that arrive together share one attempt. The check and the assignment happen with
    // nothing awaited between them, so no second caller can slip in and start a second service.
    this.pending ??= this.ensure(url).finally(() => {
      this.pending = null;
    });
    await this.pending;
    return url;
  }

  private async ensure(url: string): Promise<void> {
    if (this.child && !this.busy) return;
    if (await this.health(url)) {
      this.adopted = true; // already running, started by the user: use it and leave it alone
      return;
    }
    this.adopted = false;
    const sourceDir = this.requireSource();
    if (this.installState(sourceDir) === 'not-installed') {
      throw new ConflictException(
        'Qwen3-TTS is not set up yet. Open Settings → Qwen3-TTS and select Set up.',
      );
    }
    await this.start(url, sourceDir);
  }

  private async start(url: string, sourceDir: string): Promise<void> {
    const home = this.config.qwenTtsHome;
    this.busy = 'starting';
    this.failure = null;
    this.log = '';
    this.startedAt = null;
    const child = this.d.spawn(venvPython(home, this.d.platform), ['-m', 'qwen_tts_service'], {
      cwd: sourceDir,
      env: serviceEnv({ base: this.d.env, home, sourceDir, port: portOf(url) }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    let exited = false;
    const onData = (chunk: unknown) => (this.log = appendLog(this.log, String(chunk)));
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('error', (error) => {
      this.log = appendLog(this.log, `${error.message}\n`);
    });
    child.once('close', (code) => {
      exited = true;
      if (this.child === child) this.child = null;
      this.clearIdle();
      if (this.busy !== 'stopping') {
        this.failure = {
          phase: 'failed',
          error: lastLine(this.log) ?? `The service stopped unexpectedly (code ${code ?? '?'}).`,
        };
        this.logger.warn({ code }, 'qwen-tts service exited');
      }
    });

    try {
      const deadline = this.d.now() + this.d.startTimeoutMs;
      while (this.d.now() < deadline) {
        if (exited)
          throw new BadGatewayException(this.failureText() ?? 'The service did not start.');
        if (await this.health(url)) {
          this.startedAt = new Date(this.d.now()).toISOString();
          this.lastUsed = this.d.now();
          this.busy = null;
          this.armIdle(url);
          return;
        }
        await sleep(this.d.pollMs);
      }
      child.kill();
      throw new BadGatewayException(
        `The service did not answer within ${Math.round(this.d.startTimeoutMs / 1000)} seconds.`,
      );
    } catch (error) {
      this.busy = null;
      this.failure ??= { phase: 'failed', error: (error as Error).message };
      throw error;
    }
  }

  /** Why it failed, if it did. (A method, so TypeScript doesn't assume the close handler never ran.) */
  private failureText(): string | undefined {
    return this.failure?.error;
  }

  /** Stops a service this runtime started. One the user started is left running. */
  async stop(): Promise<void> {
    if (!this.child) {
      if (this.adopted) {
        throw new ConflictException(
          'This service was started outside Reelcraft. Stop it where you started it.',
        );
      }
      return;
    }
    await this.stopOwned();
  }

  private async stopOwned(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.busy = 'stopping';
    this.clearIdle();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill('SIGKILL'), this.d.stopGraceMs);
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      child.stdin?.end(); // the service exits when its stdin closes
    });
    this.child = null;
    this.busy = null;
    this.startedAt = null;
  }

  // -- Idle stop ------------------------------------------------------------------------------

  private armIdle(url: string): void {
    this.clearIdle();
    this.idleTimer = setInterval(() => void this.checkIdle(url), this.d.idleCheckMs);
    this.idleTimer.unref();
  }

  private clearIdle(): void {
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = null;
  }

  private async checkIdle(url: string): Promise<void> {
    if (!this.child || this.busy || this.inflight > 0) return;
    if (this.d.now() - this.lastUsed < this.d.idleMs) return;
    if (await this.downloading(url)) return; // a model is still downloading: not idle
    if (this.inflight > 0 || this.busy) return;
    this.logger.log('stopping the idle qwen-tts service');
    await this.stopOwned();
  }

  private async downloading(url: string): Promise<boolean> {
    try {
      const response = await this.d.fetch(`${url}/v1/models`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok) return false;
      const body = (await response.json()) as { data?: Array<{ state?: string }> };
      return !!body.data?.some((model) => model.state === 'downloading');
    } catch {
      return false;
    }
  }

  // -- Models the service had ready -----------------------------------------------------------

  /**
   * Reelcraft installed the service (or can run one it has installed), so a request will start it:
   * a stopped service is then expected, not "down". False when nothing is set up, or when the user
   * runs the service themselves.
   */
  async startsOnDemand(): Promise<boolean> {
    const { managed } = await this.mode();
    const sourceDir = this.sourceDir();
    return managed && !!sourceDir && this.installState(sourceDir) !== 'not-installed';
  }

  /** The models that were ready when the service last answered. */
  readyModels(): string[] {
    return this.readState()?.readyModels ?? [];
  }

  /** Remembers which models are ready, so the UI can say so while the service is stopped. */
  rememberReadyModels(ids: string[]): void {
    const state = this.readState();
    if (!state || state.readyModels.join('\n') === ids.join('\n')) return;
    this.writeState({ ...state, readyModels: ids });
  }

  // -- Detection ------------------------------------------------------------------------------

  /** Forgets what was found about `uv` and the GPU, so the next status looks again. */
  async check(): Promise<QwenTtsSetupDto> {
    this.uv = undefined;
    this.nvidia = undefined;
    return this.status();
  }

  private async resolveUv(): Promise<{ path: string; version: string } | null> {
    if (this.uv !== undefined) return this.uv;
    for (const candidate of uvCandidates(this.d.platform, this.d.homedir, this.d.env)) {
      try {
        const { stdout } = await this.d.execFile(candidate, ['--version'], { timeout: 5_000 });
        const version = /uv\s+(\S+)/.exec(stdout)?.[1];
        if (version) return (this.uv = { path: candidate, version });
      } catch {
        // not here: try the next place
      }
    }
    return (this.uv = null);
  }

  private async detectNvidia(): Promise<string | null> {
    if (this.nvidia !== undefined) return this.nvidia;
    try {
      const { stdout } = await this.d.execFile(
        'nvidia-smi',
        ['--query-gpu=name', '--format=csv,noheader'],
        { timeout: 3_000 },
      );
      return (this.nvidia = stdout.split('\n')[0]?.trim() || null);
    } catch {
      return (this.nvidia = null);
    }
  }

  // -- Helpers --------------------------------------------------------------------------------

  private async mode(): Promise<{ managed: boolean; url: string }> {
    const { url, source } = await this.settings.qwenTts();
    return { managed: source === 'default', url };
  }

  private sourceDir(): string | null {
    const dir = this.config.qwenTtsSourceDir;
    return dir && existsSync(path.join(dir, 'pyproject.toml')) ? dir : null;
  }

  private requireSource(): string {
    const dir = this.sourceDir();
    if (!dir) {
      throw new ConflictException(
        'This copy of Reelcraft has no Qwen3-TTS service to set up. Run one yourself and save its address in Settings.',
      );
    }
    return dir;
  }

  private async health(url: string): Promise<Health | null> {
    try {
      const response = await this.d.fetch(`${url}/health`, { signal: AbortSignal.timeout(1_500) });
      if (!response.ok) return null;
      const body = (await response.json()) as Health;
      return body.service === SERVICE_ID ? body : null;
    } catch {
      return null;
    }
  }

  private statePath(): string {
    return path.join(this.config.qwenTtsHome, 'state.json');
  }

  private readState(): InstallState | null {
    try {
      return JSON.parse(readFileSync(this.statePath(), 'utf8')) as InstallState;
    } catch {
      return null;
    }
  }

  private writeState(state: InstallState): void {
    mkdirSync(this.config.qwenTtsHome, { recursive: true });
    writeFileSync(this.statePath(), JSON.stringify(state, null, 2));
  }

  private fingerprintOf(sourceDir: string, backend: QwenTtsBackend): string | null {
    try {
      return fingerprint(readFileSync(path.join(sourceDir, 'constraints.txt'), 'utf8'), backend);
    } catch {
      return null;
    }
  }

  /** `not-installed`: no environment. `outdated`: one for other pins than this Reelcraft wants. */
  private installState(sourceDir: string): 'not-installed' | 'outdated' | 'installed' {
    const state = this.readState();
    const python = venvPython(this.config.qwenTtsHome, this.d.platform);
    if (!state || !existsSync(python)) return 'not-installed';
    return state.fingerprint === this.fingerprintOf(sourceDir, state.backend)
      ? 'installed'
      : 'outdated';
  }

  /** Free space on the disk the packages go to (the nearest folder that exists, as it may not yet). */
  private freeBytes(home: string): number | null {
    let dir = home;
    while (!existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
    try {
      const stats = statfsSync(dir);
      return stats.bavail * stats.bsize;
    } catch {
      return null;
    }
  }
}

const gb = (bytes: number) => (bytes / 1e9).toFixed(1);
