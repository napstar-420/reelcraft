// Checks for, installs and rolls back app updates. One instance runs inside
// the root-owned update agent; the API only relays the user's requests.
//
// An install downloads and verifies the bundle, unpacks it into
// /data/app/versions, backs up the database, then restarts the API on the new
// bundle as a "trial". The trial becomes the active version once the API
// reports healthy on it; otherwise the database backup is restored and the
// previous version starts again.
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chown, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import path from 'node:path';
import { checkForUpdate, fetchVerifiedManifest, needsNewImage } from './releases.mjs';
import { installedUsable, selectApp } from './select-app.mjs';
import { readState, versionDir, writeState } from './state.mjs';
import { isNewer, isReleaseVersion } from './versions.mjs';

export const TRIAL_TIMEOUT_MS = 5 * 60_000;
const BACKUPS_KEPT = 3;
/** Free space an install needs, as a multiple of the compressed bundle: the
 * download itself plus the unpacked app, with headroom for the backup. */
const SPACE_FACTOR = 6;

export class UpdateError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

async function restoreDatabase(system, backup) {
  await system.run('dropdb', ['--force', '--if-exists', 'reelcraft']);
  await system.run('createdb', ['reelcraft']);
  await system.run('pg_restore', ['--no-owner', '--exit-on-error', '-d', 'reelcraft', backup]);
}

/** Undoes a trial that never confirmed: the database goes back to its
 * pre-update backup and the previous version becomes active again. The API
 * must not be running. */
async function revertTrial({ paths, system, log, imageVersion }, state, reason) {
  const { trial } = state;
  let error = reason;
  try {
    await restoreDatabase(system, trial.backup);
  } catch (err) {
    log(`restoring the database from ${trial.backup} failed: ${err.message}`);
    error = `${reason} Restoring the database backup failed too; it is kept at ${trial.backup}.`;
  }
  const next = {
    ...state,
    active: trial.previous,
    trial: null,
    lastResult: {
      ok: false,
      from: trial.previous?.version ?? imageVersion ?? null,
      to: trial.version,
      at: new Date(system.now()).toISOString(),
      error,
    },
  };
  await writeState(paths, next);
  await rm(versionDir(paths, trial.version), { recursive: true, force: true });
  return next;
}

/** Run once at container start, before migrations: a trial still pending
 * means the container stopped mid-update, so that update is undone. */
export async function reconcileAfterRestart({ paths, system, log, imageVersion }) {
  const state = await readState(paths);
  if (!state.trial) return false;
  log(`update to ${state.trial.version} did not finish before a restart; rolling back`);
  await revertTrial(
    { paths, system, log, imageVersion },
    state,
    `The update to ${state.trial.version} was interrupted by a restart and was rolled back.`,
  );
  return true;
}

export function createUpdater({
  paths,
  image,
  github,
  publicKey,
  arch,
  system,
  owner,
  enabled = true,
  trialTimeoutMs = TRIAL_TIMEOUT_MS,
  log = (message) => console.log(`reelcraft-updater: ${message}`),
}) {
  const status = {
    phase: 'idle',
    progress: null,
    latest: null,
    lastCheckedAt: null,
    lastError: null,
  };
  let busy = null;
  let checking = null;
  const ctx = { paths, system, log, imageVersion: image.version };
  const releaseVersion = isReleaseVersion(image.version);

  const setPhase = (phase, progress = null) => {
    status.phase = phase;
    status.progress = progress;
  };

  async function current() {
    return selectApp({ image, state: await readState(paths), paths });
  }

  async function prune(state, keep) {
    const keepNames = new Set(keep.filter(Boolean));
    const versions = await readdir(paths.versionsDir).catch(() => []);
    for (const name of versions) {
      if (!keepNames.has(name)) {
        await rm(path.join(paths.versionsDir, name), { recursive: true, force: true });
      }
    }
    const backups = (await readdir(paths.backupsDir).catch(() => []))
      .filter((name) => name.endsWith('.dump'))
      .sort()
      .reverse();
    for (const name of backups.slice(BACKUPS_KEPT)) {
      await rm(path.join(paths.backupsDir, name), { force: true });
    }
    return state;
  }

  async function confirmTrial(state) {
    const { trial } = state;
    const next = {
      ...state,
      active: { version: trial.version, runtime: trial.runtime },
      trial: null,
      lastResult: {
        ok: true,
        from: trial.previous?.version ?? image.version,
        to: trial.version,
        at: new Date(system.now()).toISOString(),
      },
    };
    await writeState(paths, next);
    await prune(next, [trial.version, trial.previous?.version]);
    log(`update to ${trial.version} is healthy`);
    if (status.latest) status.latest.newer = false;
  }

  /** Waits for the API to report healthy on the trial version, then keeps
   * it, or rolls back when the deadline passes. */
  async function watchTrial() {
    const state = await readState(paths);
    const { trial } = state;
    if (!trial) return;
    setPhase('restarting');
    const deadline = Date.parse(trial.startedAt) + trialTimeoutMs;
    while (system.now() < deadline) {
      const health = await system.health();
      if (health?.status === 'ok' && health.version === trial.version) {
        await confirmTrial(state);
        return;
      }
      await system.sleep(2000);
    }
    log(`update to ${trial.version} did not become healthy in time; rolling back`);
    setPhase('rolling-back');
    await system.stopApi();
    try {
      await revertTrial(
        ctx,
        state,
        `Version ${trial.version} did not start correctly, so Reelcraft went back to ` +
          `${trial.previous?.version ?? image.version}. The container logs have the details.`,
      );
    } finally {
      await system.startApi();
    }
  }

  async function download(url, bundle, file) {
    const res = await github.download(url);
    const hash = createHash('sha256');
    const out = createWriteStream(file, { mode: 0o600 });
    let received = 0;
    setPhase('downloading', { received, total: bundle.bytes });
    try {
      for await (const chunk of res.body) {
        received += chunk.length;
        if (received > bundle.bytes)
          throw new Error('the download is larger than the release says');
        hash.update(chunk);
        status.progress = { received, total: bundle.bytes };
        if (!out.write(chunk)) await once(out, 'drain');
      }
      out.end();
      await finished(out);
    } catch (err) {
      out.destroy();
      throw err;
    }
    setPhase('verifying');
    if (received !== bundle.bytes || hash.digest('hex') !== bundle.sha256) {
      throw new Error('the downloaded update does not match its signed checksum');
    }
  }

  async function unpack(file, version) {
    const target = versionDir(paths, version);
    const staging = `${target}.tmp`;
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true, mode: 0o755 });
    try {
      await system.run('tar', ['-xzf', file, '-C', staging]);
      const pkg = JSON.parse(await readFile(path.join(staging, 'package.json'), 'utf8'));
      if (pkg.version !== version) {
        throw new Error(`the update bundle contains version ${pkg.version}, not ${version}`);
      }
      // Remotion's webpack bundle cache is the one place the app writes to.
      const cache = path.join(staging, 'apps/render-worker/node_modules/.cache');
      await mkdir(cache, { recursive: true });
      if (owner) await chown(cache, owner.uid, owner.gid);
    } catch (err) {
      await rm(staging, { recursive: true, force: true });
      throw err;
    }
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
  }

  async function backupDatabase(version) {
    await mkdir(paths.backupsDir, { recursive: true, mode: 0o700 });
    const stamp = new Date(system.now()).toISOString().replace(/[:.]/g, '-');
    const file = path.join(paths.backupsDir, `pre-${version}-${stamp}.dump`);
    await system.run('pg_dump', ['-Fc', '-f', file, 'reelcraft']);
    return file;
  }

  async function install(version) {
    const tag = `v${version}`;
    setPhase('checking');
    const release = await github.getRelease(tag);
    const { manifest, bundle, bundleUrl } = await fetchVerifiedManifest({
      github,
      release,
      version,
      publicKey,
      arch,
    });
    if (needsNewImage(manifest, image)) {
      throw new UpdateError(`Version ${version} needs a newer Reelcraft image.`);
    }
    const running = await current();
    if (!isNewer(version, running.version)) {
      throw new UpdateError(`Version ${version} is not newer than ${running.version}.`);
    }

    await mkdir(paths.downloadsDir, { recursive: true });
    await mkdir(paths.versionsDir, { recursive: true });
    const free = await system.freeBytes(paths.appDir);
    if (free < bundle.bytes * SPACE_FACTOR) {
      const needMb = Math.ceil((bundle.bytes * SPACE_FACTOR) / 1e6);
      throw new UpdateError(
        `Not enough disk space for the update: it needs about ${needMb} MB free in Docker.`,
      );
    }

    const file = path.join(paths.downloadsDir, bundle.file);
    try {
      await download(bundleUrl, bundle, file);
      setPhase('installing');
      await unpack(file, version);
    } finally {
      await rm(file, { force: true });
    }

    setPhase('backing-up');
    const backup = await backupDatabase(version);

    const state = await readState(paths);
    await writeState(paths, {
      ...state,
      trial: {
        version,
        runtime: manifest.runtime,
        previous:
          running.source === 'image'
            ? null
            : { version: running.version, runtime: running.runtime },
        backup,
        startedAt: new Date(system.now()).toISOString(),
      },
    });
    log(`switching to ${version}`);
    setPhase('restarting');
    // If the restart request itself fails, the trial times out and rolls back.
    await system.restartApi().catch((err) => log(`restarting the API failed: ${err.message}`));
    await watchTrial();
  }

  /** Run whenever the agent starts. */
  async function start() {
    await mkdir(paths.versionsDir, { recursive: true });
    await rm(paths.downloadsDir, { recursive: true, force: true });
    await mkdir(paths.downloadsDir, { recursive: true });
    for (const name of await readdir(paths.versionsDir)) {
      if (name.endsWith('.tmp')) {
        await rm(path.join(paths.versionsDir, name), { recursive: true, force: true });
      }
    }
    const state = await readState(paths);
    if (state.trial) {
      // Only the agent restarted while the API was on trial: keep watching.
      busy = runInstallTask(() => watchTrial(), state.trial.version);
      return;
    }
    if (state.active && !installedUsable(state.active, image)) {
      // The image is now at least as new as the installed update (or can't
      // run it), so the image's own bundle runs and the old update goes.
      log(`image ${image.version} replaces installed update ${state.active.version}`);
      await writeState(paths, { ...state, active: null });
      await prune(state, []);
    }
  }

  function runInstallTask(task, version) {
    return task()
      .catch(async (err) => {
        log(`update failed: ${err.message}`);
        const state = await readState(paths).catch(() => null);
        if (state) {
          await writeState(paths, {
            ...state,
            lastResult: {
              ok: false,
              from: (await current().catch(() => null))?.version ?? null,
              to: version,
              at: new Date(system.now()).toISOString(),
              error: err.message,
            },
          }).catch(() => {});
        }
      })
      .finally(() => {
        setPhase('idle');
        busy = null;
      });
  }

  async function check() {
    if (!enabled) throw new UpdateError('Update checks are turned off (REELCRAFT_UPDATES=off).');
    if (!releaseVersion) throw new UpdateError('Development builds are not updated.');
    if (checking) return checking;
    checking = (async () => {
      try {
        const running = await current();
        status.latest = await checkForUpdate({
          github,
          image,
          current: running.version,
          publicKey,
          arch,
        });
        status.lastError = null;
      } catch (err) {
        status.lastError = `Could not check for updates: ${err.message}`;
        log(status.lastError);
      } finally {
        status.lastCheckedAt = new Date(system.now()).toISOString();
        checking = null;
      }
    })();
    return checking;
  }

  return {
    start,
    check,
    async getStatus() {
      const state = await readState(paths);
      const running = selectApp({ image, state, paths });
      return {
        current: { version: running.version, source: running.source },
        image: { version: image.version, runtime: image.runtime },
        updatesEnabled: enabled && releaseVersion,
        latest: status.latest,
        phase: status.phase,
        progress: status.progress,
        lastCheckedAt: status.lastCheckedAt,
        lastError: status.lastError,
        lastResult: state.lastResult,
      };
    },
    /** Starts installing `version` in the background; progress shows in the
     * status. Rejects right away if an install cannot start. */
    async startInstall(version) {
      if (!enabled || !releaseVersion) throw new UpdateError('Updates are not available here.');
      if (busy) throw new UpdateError('An update is already in progress.', 409);
      if (typeof version !== 'string' || !isReleaseVersion(version)) {
        throw new UpdateError('Choose a release version to install.');
      }
      busy = runInstallTask(() => install(version), version);
    },
    /** For tests: resolves when the running install finishes. */
    idle: () => busy ?? Promise.resolve(),
  };
}
