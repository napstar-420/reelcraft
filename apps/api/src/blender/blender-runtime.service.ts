import { execFile as nodeExecFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, createWriteStream, existsSync } from 'node:fs';
import { access, mkdir, rename, rm, statfs } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import type { BlenderDevice, BlenderSetupDto, BlenderSource } from '@reelcraft/shared';
import { EngineConfig } from '../config/engine-config';
import { SETTING, SettingsService } from '../settings/settings.service';
import {
  BASE_ARGS,
  BLENDER_VERSION,
  blenderBuild,
  blenderEnv,
  downloadUrl,
  managedBinary,
  nativeCandidates,
  onPath,
  parseProbe,
  type BlenderBuild,
} from './blender-runtime';

const execFileAsync = promisify(nodeExecFile);

/** The Python scripts Reelcraft runs inside Blender (`probe.py`, `run_scene.py`). */
export const BLENDER_SCRIPTS_DIR = path.resolve(__dirname, '../../../render-worker/blender');

/** Starting Blender and listing GPUs can take a while the first time (driver caches). */
const PROBE_TIMEOUT_MS = 120_000;
/** Room to leave on the disk after unpacking (the archive unpacks to about three times its size). */
const UNPACK_FACTOR = 3;

type Exec = (
  command: string,
  args: string[],
  options: { timeout: number; env: Record<string, string> },
) => Promise<{ stdout: string; stderr: string }>;

export interface BlenderRuntimeDeps {
  exec?: Exec;
  fetch?: typeof fetch;
  platform?: NodeJS.Platform;
  arch?: string;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
  exists?: (file: string) => Promise<boolean>;
}

interface Probe {
  version: string | null;
  devices: BlenderDevice[];
  error: string | null;
}

type Install = BlenderSetupDto['install'];

/**
 * Finds the Blender that renders scenes, and downloads one when asked.
 *
 * Blender is used in this order: a path saved in Settings, `BLENDER_PATH`, the copy Reelcraft
 * downloaded, then one already installed on this computer. A saved or environment path that
 * doesn't work is reported, never silently skipped. Nothing is downloaded unless the user asks.
 */
@Injectable()
export class BlenderRuntime {
  private readonly logger = new Logger(BlenderRuntime.name);
  private readonly d: Required<BlenderRuntimeDeps>;
  private probed = new Map<string, Promise<Probe>>();
  private install: Install = { state: 'idle', receivedBytes: 0, error: null };
  private abort: AbortController | null = null;

  constructor(
    private readonly config: EngineConfig,
    private readonly settings: SettingsService,
    deps: BlenderRuntimeDeps = {},
  ) {
    this.d = {
      exec: deps.exec ?? ((command, args, options) => execFileAsync(command, args, options)),
      fetch: deps.fetch ?? fetch,
      platform: deps.platform ?? process.platform,
      arch: deps.arch ?? process.arch,
      env: deps.env ?? process.env,
      homedir: deps.homedir ?? os.homedir(),
      exists:
        deps.exists ??
        ((file) =>
          access(file, constants.X_OK).then(
            () => true,
            () => false,
          )),
    };
    settings.onChange((key) => {
      if (key === SETTING.blenderPath) this.probed.clear();
    });
  }

  /** The Blender to use, and where it was found; undefined when there is none. */
  async resolve(): Promise<{ path: string; source: BlenderSource } | undefined> {
    const saved = await this.settings.get(SETTING.blenderPath);
    if (saved) return { path: saved, source: 'saved' };
    const env = this.config.blenderPathFromEnv;
    if (env) return { path: env, source: 'env' };
    const build = this.build();
    if (build) {
      const managed = managedBinary(this.config.blenderHome, build, this.d.platform);
      if (await this.d.exists(managed)) return { path: managed, source: 'managed' };
    }
    for (const candidate of nativeCandidates(this.d.platform, this.d.homedir, this.d.env)) {
      const options = path.isAbsolute(candidate)
        ? [candidate]
        : onPath(candidate, this.d.platform, this.d.env);
      for (const option of options) {
        if (await this.d.exists(option)) return { path: option, source: 'found' };
      }
    }
    return undefined;
  }

  /** The Blender executable to render with, checked to start. Throws a message for people. */
  async binary(): Promise<string> {
    const found = await this.resolve();
    if (!found) {
      throw new Error(
        'Blender is not set up. Open Settings, then Blender, to download it or choose the one installed on this computer.',
      );
    }
    const probe = await this.probe(found.path);
    if (!probe.version) throw new Error(`Blender at ${found.path} can't be used: ${probe.error}`);
    return found.path;
  }

  async status(): Promise<BlenderSetupDto> {
    const found = await this.resolve();
    const probe = found
      ? await this.probe(found.path)
      : { version: null, devices: [], error: 'No Blender was found on this computer.' };
    const build = this.build();
    return {
      path: found?.path ?? null,
      source: found?.source ?? null,
      version: probe.version,
      devices: probe.devices,
      error: probe.error,
      download: build ? { version: BLENDER_VERSION, bytes: build.bytes } : null,
      install: { ...this.install },
      homeDir: this.config.blenderHome,
      inContainer: existsSync('/.dockerenv'),
    };
  }

  /** Forgets what was found and looks again. */
  async check(): Promise<BlenderSetupDto> {
    this.probed.clear();
    return this.status();
  }

  async savePath(value: string | null): Promise<BlenderSetupDto> {
    if (value === null) await this.settings.delete(SETTING.blenderPath);
    else await this.settings.set(SETTING.blenderPath, value);
    this.probed.clear();
    return this.status();
  }

  /** Starts downloading and unpacking the pinned Blender, and returns at once; poll `status`. */
  async startInstall(): Promise<void> {
    if (this.install.state === 'downloading' || this.install.state === 'extracting') return;
    const build = this.build();
    if (!build) {
      throw new ConflictException(
        'There is no Blender download for this computer. Install Blender from blender.org and choose it in Settings.',
      );
    }
    const home = this.config.blenderHome;
    await mkdir(home, { recursive: true });
    const free = await statfs(home).then((fs) => fs.bavail * fs.bsize);
    if (free < build.bytes * (UNPACK_FACTOR + 1)) {
      throw new ConflictException(
        `Not enough disk space in ${home}: Blender needs about ${Math.ceil((build.bytes * (UNPACK_FACTOR + 1)) / 1e9)} GB.`,
      );
    }
    this.abort = new AbortController();
    this.install = { state: 'downloading', receivedBytes: 0, error: null };
    void this.download(build, home, this.abort.signal).catch((error: unknown) => {
      const cancelled = this.abort?.signal.aborted;
      this.install = {
        state: cancelled ? 'idle' : 'failed',
        receivedBytes: 0,
        error: cancelled ? null : (error as Error).message,
      };
      if (!cancelled) this.logger.warn({ err: error }, 'blender install failed');
    });
  }

  cancelInstall(): void {
    this.abort?.abort();
  }

  private async download(build: BlenderBuild, home: string, signal: AbortSignal): Promise<void> {
    const archive = path.join(home, build.file);
    const partial = `${archive}.part`;
    const response = await this.d.fetch(downloadUrl(build), { signal });
    if (!response.ok || !response.body) {
      throw new Error(`Downloading Blender failed: HTTP ${response.status}`);
    }
    const hash = createHash('sha256');
    const body = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
    body.on('data', (chunk: Buffer) => {
      hash.update(chunk);
      this.install.receivedBytes += chunk.length;
    });
    try {
      await pipeline(body, createWriteStream(partial), { signal });
      const digest = hash.digest('hex');
      if (digest !== build.sha256) {
        throw new Error(`The Blender download is corrupt (sha256 ${digest}); try again.`);
      }
      await rename(partial, archive);
      this.install.state = 'extracting';
      // `tar` unpacks both: GNU tar the Linux .tar.xz, and Windows' own bsdtar the .zip.
      await this.d.exec('tar', ['-xf', archive, '-C', home], {
        timeout: 15 * 60_000,
        env: blenderEnv(this.d.env),
      });
    } finally {
      await rm(partial, { force: true });
      await rm(archive, { force: true });
    }
    this.probed.clear();
    this.install = { state: 'idle', receivedBytes: 0, error: null };
    this.logger.log({ version: BLENDER_VERSION, home }, 'blender installed');
  }

  private probe(binary: string): Promise<Probe> {
    let pending = this.probed.get(binary);
    if (!pending) {
      pending = this.runProbe(binary);
      this.probed.set(binary, pending);
    }
    return pending;
  }

  private async runProbe(binary: string): Promise<Probe> {
    try {
      const { stdout } = await this.d.exec(
        binary,
        [...BASE_ARGS, '--python', path.join(BLENDER_SCRIPTS_DIR, 'probe.py')],
        { timeout: PROBE_TIMEOUT_MS, env: blenderEnv(this.d.env) },
      );
      const parsed = parseProbe(stdout);
      if (!parsed) return { version: null, devices: [], error: `${binary} is not Blender.` };
      return { version: parsed.version, devices: parsed.devices, error: parsed.error ?? null };
    } catch (error) {
      this.logger.warn({ binary, err: error }, 'blender probe failed');
      const code = (error as { code?: string }).code;
      return {
        version: null,
        devices: [],
        error:
          code === 'ENOENT'
            ? `There is no Blender at ${binary}.`
            : `Blender at ${binary} did not start: ${(error as Error).message.split('\n')[0]}`,
      };
    }
  }

  private build(): BlenderBuild | undefined {
    return blenderBuild(this.d.platform, this.d.arch);
  }
}
