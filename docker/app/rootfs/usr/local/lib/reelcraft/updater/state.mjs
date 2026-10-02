// Where updates live in the /data volume, and the state file that records
// which installed version is active or on trial.
import { readFileSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const IMAGE_APP_DIR = '/opt/reelcraft/app';
export const IMAGE_RUNTIME_FILE = '/opt/reelcraft/RUNTIME_VERSION';
export const PUBLIC_KEY_FILE = '/opt/reelcraft/release-signing.pub';

export function updaterPaths(dataDir = '/data') {
  const appDir = path.join(dataDir, 'app');
  return {
    appDir,
    versionsDir: path.join(appDir, 'versions'),
    downloadsDir: path.join(appDir, 'downloads'),
    stateFile: path.join(appDir, 'state.json'),
    backupsDir: path.join(dataDir, 'backups'),
  };
}

export function versionDir(paths, version) {
  return path.join(paths.versionsDir, version);
}

/** The app bundle and runtime the image itself ships. */
export function readImageInfo(env = process.env, runtimeFile = IMAGE_RUNTIME_FILE) {
  const runtime = Number(readFileSync(runtimeFile, 'utf8').trim());
  if (!Number.isInteger(runtime) || runtime < 1) {
    throw new Error(`${runtimeFile} does not hold a runtime version`);
  }
  return {
    version: env.REELCRAFT_IMAGE_VERSION ?? env.REELCRAFT_VERSION ?? 'dev',
    runtime,
    appDir: IMAGE_APP_DIR,
  };
}

/**
 * `active`: the installed update that runs instead of the image's bundle.
 * `trial`: an update that was just switched to and has not reported healthy
 *   yet; `previous` is what to return to (null means the image's bundle).
 * `lastResult`: the outcome of the most recent install, shown in the app.
 */
export function emptyState() {
  return { schema: 1, active: null, trial: null, lastResult: null };
}

export async function readState(paths) {
  let raw;
  try {
    raw = await readFile(paths.stateFile, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return emptyState();
    throw err;
  }
  return { ...emptyState(), ...JSON.parse(raw) };
}

export function readStateSync(paths) {
  try {
    return { ...emptyState(), ...JSON.parse(readFileSync(paths.stateFile, 'utf8')) };
  } catch (err) {
    if (err.code === 'ENOENT') return emptyState();
    throw err;
  }
}

/** Replaces the state file atomically, so a crash never leaves half of it. */
export async function writeState(paths, state) {
  const tmp = `${paths.stateFile}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o644 });
  await rename(tmp, paths.stateFile);
}
