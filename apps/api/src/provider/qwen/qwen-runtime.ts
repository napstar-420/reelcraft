import { createHash } from 'node:crypto';
import path from 'node:path';
import type { QwenTtsBackend } from '@reelcraft/shared';

/**
 * Pure helpers for `QwenTtsRuntime`: where things are on each OS, the commands it runs, and what the
 * service it starts is allowed to see. Kept free of I/O so each can be tested on its own.
 */

/** A running service stops after this long with nothing asking it for speech. */
export const IDLE_STOP_MS = 10 * 60_000;
/** How long a freshly started service may take to answer `/health` (importing PyTorch is slow). */
export const START_TIMEOUT_MS = 60_000;
export const HEALTH_POLL_MS = 500;
/** How long a stopping service gets to exit on its own before it is killed. */
export const STOP_GRACE_MS = 5_000;
/** The `service` field `/health` answers with: tells our service from anything else on the port. */
export const SERVICE_ID = 'reelcraft-qwen-tts';
/** The most install or service output kept for the UI. */
export const LOG_TAIL_BYTES = 16 * 1024;

/** The Python the packages are installed for (the service requires >=3.12,<3.13). */
export const PYTHON_VERSION = '3.12';

/** The packages are 1.2 GB on a Mac (measured). Elsewhere it is a guess, and a CUDA build is much larger. */
const PACKAGES_MEASURED_BYTES = 1.2e9;
const PACKAGES_NVIDIA_GUESS_BYTES = 5e9;
/** Room to leave on the disk after installing. */
export const DISK_MARGIN_BYTES = 1e9;

export function packageSize(
  platform: NodeJS.Platform,
  nvidiaGpu: string | null,
): { bytes: number; estimated: boolean } {
  if (nvidiaGpu) return { bytes: PACKAGES_NVIDIA_GUESS_BYTES, estimated: true };
  return { bytes: PACKAGES_MEASURED_BYTES, estimated: platform !== 'darwin' };
}

/** The virtual environment's Python: the layout differs on Windows. */
export function venvPython(home: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32'
    ? path.win32.join(home, 'venv', 'Scripts', 'python.exe')
    : path.posix.join(home, 'venv', 'bin', 'python');
}

/** Where `uv` may be, in the order to try. A fresh install is often not on the API's PATH yet. */
export function uvCandidates(
  platform: NodeJS.Platform,
  homedir: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (platform === 'win32') {
    const profile = env.USERPROFILE ?? homedir;
    return [
      'uv.exe',
      path.win32.join(profile, '.local', 'bin', 'uv.exe'),
      path.win32.join(profile, '.cargo', 'bin', 'uv.exe'),
    ];
  }
  return [
    'uv',
    path.posix.join(homedir, '.local', 'bin', 'uv'),
    path.posix.join(homedir, '.cargo', 'bin', 'uv'),
  ];
}

export const venvArgs = (venvDir: string): string[] => [
  'venv',
  venvDir,
  '--python',
  PYTHON_VERSION,
];

/**
 * `uv pip install` for the service's runtime. `--torch-backend` makes uv pick the PyTorch build for
 * this computer's GPU (`auto`, which falls back to the CPU one) or the CPU one outright. The pins come
 * from `constraints.txt` as constraints (`-c`), not requirements, so wheels that only suit another
 * platform are never installed.
 */
export function installArgs(opts: {
  python: string;
  sourceDir: string;
  backend: QwenTtsBackend;
}): string[] {
  return [
    'pip',
    'install',
    '--python',
    opts.python,
    '--torch-backend',
    opts.backend,
    '-r',
    path.join(opts.sourceDir, 'pyproject.toml'),
    '--extra',
    'engine',
    '-c',
    path.join(opts.sourceDir, 'constraints.txt'),
  ];
}

/**
 * What the child processes may inherit. An allowlist, never `process.env`: that holds the database
 * password and provider keys, which Python (and everything it installs) has no business reading.
 */
const INHERITED = new Set([
  'PATH',
  'HOME',
  'USERPROFILE',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'COMSPEC',
  'PATHEXT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LOCALAPPDATA',
  'APPDATA',
  'PROGRAMDATA',
  'LANG',
  'LC_ALL',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
]);

function inherited(base: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    const name = key.toUpperCase();
    if (value !== undefined && (INHERITED.has(name) || name.startsWith('UV_'))) out[key] = value;
  }
  return out;
}

/** The environment `uv` runs with. */
export function installEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  return { ...inherited(base), NO_COLOR: '1' };
}

/** The environment the service runs with. */
export function serviceEnv(opts: {
  base: NodeJS.ProcessEnv;
  home: string;
  sourceDir: string;
  port: string;
}): Record<string, string> {
  return {
    ...inherited(opts.base),
    PYTHONPATH: path.join(opts.sourceDir, 'src'),
    PYTHONUNBUFFERED: '1',
    QWEN_TTS_MODELS_DIR: path.join(opts.home, 'models'),
    QWEN_TTS_HOST: '127.0.0.1',
    QWEN_TTS_PORT: opts.port,
    // The service exits when we do (see `exit_with_parent` in the service), so it is never orphaned.
    QWEN_TTS_EXIT_WITH_STDIN: '1',
    // Our polling would flood the log tail the UI shows.
    QWEN_TTS_ACCESS_LOG: '0',
  };
}

/** What identifies an install: the pinned packages and the PyTorch build chosen for them. */
export function fingerprint(constraints: string, backend: QwenTtsBackend): string {
  return createHash('sha256').update(constraints).update('\n').update(backend).digest('hex');
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** Appends output to the log tail, dropping colour codes and keeping only the last `LOG_TAIL_BYTES`. */
export function appendLog(log: string, chunk: string): string {
  return (log + chunk.replace(ANSI, '').replace(/\r\n?/g, '\n')).slice(-LOG_TAIL_BYTES);
}

/** The last line of output worth showing as an error. */
export function lastLine(log: string): string | null {
  const lines = log
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1)?.slice(0, 300) ?? null;
}

/** The port of the managed service, from its address. */
export function portOf(url: string): string {
  const port = new URL(url).port;
  return port || '8091';
}
