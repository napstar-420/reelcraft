import path from 'node:path';
import type { BlenderDevice } from '@reelcraft/shared';
import { inheritedEnv } from '../common/child-env';

/**
 * Pure helpers for `BlenderRuntime`: which Blender to download, where Blender may already be on
 * each OS, how to read the probe, and what Blender is allowed to see. Free of I/O so each can be
 * tested on its own.
 */

/** The Blender LTS release Reelcraft downloads. The scene guide is written for this version. */
export const BLENDER_VERSION = '5.2.2';
const RELEASE_DIR = 'https://download.blender.org/release/Blender5.2';

export interface BlenderBuild {
  /** The archive's name on download.blender.org; also the folder it unpacks to, without the extension. */
  file: string;
  bytes: number;
  sha256: string;
}

/** Official builds Reelcraft can unpack. There is no Linux arm64 build, and macOS ships as a disk
 * image, so on those Blender is installed by hand (or its path saved in Settings). */
const BUILDS: Record<string, BlenderBuild> = {
  'linux-x64': {
    file: 'blender-5.2.2-linux-x64.tar.xz',
    bytes: 383_295_504,
    sha256: '84098912789dc450e95697c4184fb8a90acbe5111c2ba4aede3fecb57806a168',
  },
  'win32-x64': {
    file: 'blender-5.2.2-windows-x64.zip',
    bytes: 404_453_484,
    sha256: '3849d17a682cba006075aaa3f3597ecb5c9c30ec31035b2e092c53e40679b535',
  },
  'win32-arm64': {
    file: 'blender-5.2.2-windows-arm64.zip',
    bytes: 274_036_892,
    sha256: '2e90b53c9443cc56d2be75a61550a38e4aba942c8cded046ceff98ed58ebc67b',
  },
};

export function blenderBuild(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): BlenderBuild | undefined {
  return BUILDS[`${platform}-${arch}`];
}

export const downloadUrl = (build: BlenderBuild): string => `${RELEASE_DIR}/${build.file}`;

/** The folder an archive unpacks to: its name without `.tar.xz` / `.zip`. */
export const unpackedDir = (build: BlenderBuild): string =>
  build.file.replace(/\.tar\.xz$|\.zip$/, '');

/** The downloaded Blender's executable, inside `home`. */
export function managedBinary(
  home: string,
  build: BlenderBuild,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === 'win32'
    ? path.win32.join(home, unpackedDir(build), 'blender.exe')
    : path.posix.join(home, unpackedDir(build), 'blender');
}

/** Where an installed Blender usually is, in the order to try. A bare name is looked up on PATH. */
export function nativeCandidates(
  platform: NodeJS.Platform,
  homedir: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (platform === 'darwin') {
    return [
      '/Applications/Blender.app/Contents/MacOS/Blender',
      path.posix.join(homedir, 'Applications', 'Blender.app', 'Contents', 'MacOS', 'Blender'),
      'blender',
    ];
  }
  if (platform === 'win32') {
    const programFiles = env.ProgramFiles ?? 'C:\\Program Files';
    // The installer puts each version in its own folder; newest first.
    const versions = ['5.2', '5.1', '5.0', '4.5'];
    return [
      ...versions.map((version) =>
        path.win32.join(programFiles, 'Blender Foundation', `Blender ${version}`, 'blender.exe'),
      ),
      'blender.exe',
    ];
  }
  return ['blender', '/usr/bin/blender', '/usr/local/bin/blender', '/snap/bin/blender'];
}

/** Every place a bare command name could be on PATH. */
export function onPath(
  name: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  const separator = platform === 'win32' ? ';' : ':';
  return (env.PATH ?? env.Path ?? '')
    .split(separator)
    .filter(Boolean)
    .map((dir) => join(dir, name));
}

const PROBE_MARKER = 'REELCRAFT_PROBE ';
const BACKENDS = new Set(['OPTIX', 'CUDA', 'HIP', 'METAL', 'ONEAPI']);

/** Reads `probe.py`'s report from Blender's output. */
export function parseProbe(
  stdout: string,
): { version: string; devices: BlenderDevice[]; error?: string } | undefined {
  const line = stdout.split('\n').find((candidate) => candidate.startsWith(PROBE_MARKER));
  if (!line) return undefined;
  try {
    const parsed = JSON.parse(line.slice(PROBE_MARKER.length)) as {
      version?: unknown;
      devices?: unknown;
      error?: unknown;
    };
    if (typeof parsed.version !== 'string') return undefined;
    const devices = (Array.isArray(parsed.devices) ? parsed.devices : []).filter(
      (device): device is BlenderDevice =>
        typeof device?.name === 'string' && BACKENDS.has(device?.backend),
    );
    return {
      version: parsed.version,
      devices,
      ...(typeof parsed.error === 'string' && { error: parsed.error }),
    };
  } catch {
    return undefined;
  }
}

/** GPU selection variables a container runtime sets. */
const GPU_VARIABLES = /^(NVIDIA_|CUDA_|HIP_|ROCR_|GPU_DEVICE_ORDINAL$|ONEAPI_|ZE_)/;

/** What Blender runs with: the allowlisted environment and the variables that choose GPUs. It
 * runs model-written Python, so it never sees the database password or provider keys. */
export function blenderEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  return inheritedEnv(base, (name) => GPU_VARIABLES.test(name));
}

/** The arguments every Blender Reelcraft starts uses: no window, no user preferences or add-ons,
 * and no scripts embedded in `.blend` files. */
export const BASE_ARGS = ['-b', '--factory-startup', '--disable-autoexec', '--python-exit-code', '1'];
