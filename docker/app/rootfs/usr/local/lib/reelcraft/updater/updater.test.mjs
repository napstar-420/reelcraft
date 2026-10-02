import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { emptyState, readState, updaterPaths, writeState } from './state.mjs';
import { run } from './system.mjs';
import { fakeGitHub, keypair, makeRelease } from './testing.mjs';
import { createUpdater, reconcileAfterRestart } from './updater.mjs';

const keys = keypair();
const image = { version: '0.2.0', runtime: 3, appDir: '/opt/reelcraft/app' };

/** A real tarball laid out like an app bundle. */
function bundle(version) {
  const dir = mkdtempSync(path.join(tmpdir(), 'bundle-'));
  execFileSync('mkdir', ['-p', `${dir}/apps/api/dist`, `${dir}/apps/render-worker/node_modules`]);
  execFileSync('sh', [
    '-c',
    `echo '{"version":"${version}"}' > ${dir}/package.json && echo '' > ${dir}/apps/api/dist/main.js`,
  ]);
  const out = execFileSync('tar', ['-czf', '-', '-C', dir, '.']);
  execFileSync('rm', ['-rf', dir]);
  return out;
}

/** Stands in for the container: commands are recorded (tar really runs),
 * time only moves when the updater sleeps, and the API reports whatever
 * version `healthyVersion()` returns. */
function fakeSystem({ healthyVersion = () => null } = {}) {
  let now = Date.parse('2026-10-02T12:00:00Z');
  const calls = [];
  return {
    calls,
    async run(command, args) {
      calls.push([command, ...args].join(' '));
      if (command === 'tar') return run(command, args);
      if (command === 'pg_dump') await writeFile(args[2], 'dump');
    },
    restartApi: async () => calls.push('restart api'),
    stopApi: async () => calls.push('stop api'),
    startApi: async () => calls.push('start api'),
    health: async () => {
      const version = healthyVersion();
      return version ? { status: 'ok', version } : null;
    },
    freeBytes: async () => 1e12,
    sleep: async (ms) => {
      now += ms;
    },
    now: () => now,
  };
}

let dataDir;
let paths;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'updater-'));
  paths = updaterPaths(dataDir);
  await mkdir(paths.appDir, { recursive: true });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function makeUpdater({ releases, system, ...rest }) {
  return createUpdater({
    paths,
    image,
    github: fakeGitHub(releases),
    publicKey: keys.publicPem,
    arch: 'amd64',
    system,
    log: () => {},
    ...rest,
  });
}

describe('updater', () => {
  it('installs a verified update and keeps it once the API is healthy on it', async () => {
    const system = fakeSystem({ healthyVersion: () => '0.2.1' });
    const updater = makeUpdater({
      releases: [makeRelease({ version: '0.2.1', runtime: 3, keys, bundle: bundle('0.2.1') })],
      system,
    });
    await updater.start();
    await updater.check();
    assert.equal((await updater.getStatus()).latest.newer, true);

    await updater.startInstall('0.2.1');
    await updater.idle();

    const state = await readState(paths);
    assert.deepEqual(state.active, { version: '0.2.1', runtime: 3 });
    assert.equal(state.trial, null);
    assert.equal(state.lastResult.ok, true);
    assert.equal(state.lastResult.from, '0.2.0');
    assert.ok(existsSync(path.join(paths.versionsDir, '0.2.1/apps/api/dist/main.js')));
    assert.ok(
      existsSync(path.join(paths.versionsDir, '0.2.1/apps/render-worker/node_modules/.cache')),
    );
    assert.ok(system.calls.some((c) => c.startsWith('pg_dump -Fc -f')));
    assert.ok(system.calls.includes('restart api'));
    assert.deepEqual(await readdir(paths.downloadsDir), []);

    const status = await updater.getStatus();
    assert.deepEqual(status.current, { version: '0.2.1', source: 'active' });
    assert.equal(status.phase, 'idle');
    assert.equal(status.latest.newer, false);
  });

  it('rolls back and restores the database when the update never becomes healthy', async () => {
    const system = fakeSystem({ healthyVersion: () => '0.2.0' });
    const updater = makeUpdater({
      releases: [makeRelease({ version: '0.2.1', runtime: 3, keys, bundle: bundle('0.2.1') })],
      system,
      trialTimeoutMs: 60_000,
    });
    await updater.start();
    await updater.startInstall('0.2.1');
    await updater.idle();

    const state = await readState(paths);
    assert.equal(state.active, null);
    assert.equal(state.trial, null);
    assert.equal(state.lastResult.ok, false);
    assert.equal(state.lastResult.to, '0.2.1');
    assert.match(state.lastResult.error, /went back to 0\.2\.0/);
    assert.equal(existsSync(path.join(paths.versionsDir, '0.2.1')), false);

    const order = system.calls
      .filter((c) => /api|dropdb|createdb|pg_restore/.test(c))
      .map((c) => c.split(' ').slice(0, 2).join(' '));
    assert.deepEqual(order, [
      'restart api',
      'stop api',
      'dropdb --force',
      'createdb reelcraft',
      'pg_restore --no-owner',
      'start api',
    ]);
    assert.deepEqual((await updater.getStatus()).current, { version: '0.2.0', source: 'image' });
  });

  it('refuses a bundle whose checksum does not match the signed manifest', async () => {
    const release = makeRelease({ version: '0.2.1', runtime: 3, keys, bundle: bundle('0.2.1') });
    release.files['reelcraft-app-0.2.1-linux-amd64.tar.gz'] = bundle('0.2.1-evil');
    const system = fakeSystem();
    const updater = makeUpdater({ releases: [release], system });
    await updater.start();
    await updater.startInstall('0.2.1');
    await updater.idle();

    const state = await readState(paths);
    assert.equal(state.trial, null);
    assert.equal(state.lastResult.ok, false);
    assert.match(state.lastResult.error, /does not match|larger than/);
    assert.equal(system.calls.includes('restart api'), false);
    assert.deepEqual(await readdir(paths.versionsDir), []);
  });

  it('refuses a release that needs a newer image', async () => {
    const system = fakeSystem();
    const updater = makeUpdater({
      releases: [makeRelease({ version: '0.3.0', runtime: 4, keys, bundle: bundle('0.3.0') })],
      system,
    });
    await updater.start();
    await updater.startInstall('0.3.0');
    await updater.idle();
    assert.match((await readState(paths)).lastResult.error, /needs a newer Reelcraft image/);
    assert.equal(system.calls.length, 0);
  });

  it('allows one install at a time and only for release versions', async () => {
    const updater = makeUpdater({
      releases: [makeRelease({ version: '0.2.1', runtime: 3, keys, bundle: bundle('0.2.1') })],
      system: fakeSystem({ healthyVersion: () => '0.2.1' }),
    });
    await updater.start();
    await assert.rejects(updater.startInstall('latest'), /release version/);
    await updater.startInstall('0.2.1');
    await assert.rejects(updater.startInstall('0.2.1'), /already in progress/);
    await updater.idle();
  });

  it('is disabled for development builds and when turned off', async () => {
    const dev = createUpdater({
      paths,
      image: { ...image, version: 'dev' },
      github: fakeGitHub([]),
      publicKey: keys.publicPem,
      arch: 'amd64',
      system: fakeSystem(),
      log: () => {},
    });
    assert.equal((await dev.getStatus()).updatesEnabled, false);
    await assert.rejects(dev.check(), /Development builds/);

    const off = makeUpdater({ releases: [], system: fakeSystem(), enabled: false });
    await assert.rejects(off.check(), /turned off/);
    await assert.rejects(off.startInstall('0.2.1'), /not available/);
  });

  it('keeps the last result when a check fails', async () => {
    const github = fakeGitHub([makeRelease({ version: '0.2.1', runtime: 3, keys })]);
    const updater = createUpdater({
      paths,
      image,
      github,
      publicKey: keys.publicPem,
      arch: 'amd64',
      system: fakeSystem(),
      log: () => {},
    });
    await updater.check();
    github.listReleases = async () => {
      throw new Error('getaddrinfo ENOTFOUND api.github.com');
    };
    await updater.check();
    const status = await updater.getStatus();
    assert.equal(status.latest.version, '0.2.1');
    assert.match(status.lastError, /Could not check for updates: getaddrinfo/);
    assert.ok(status.lastCheckedAt);
  });

  it('drops an installed update once the image is as new', async () => {
    await mkdir(path.join(paths.versionsDir, '0.1.5'), { recursive: true });
    await writeState(paths, { ...emptyState(), active: { version: '0.1.5', runtime: 2 } });
    const updater = makeUpdater({ releases: [], system: fakeSystem() });
    await updater.start();
    assert.equal((await readState(paths)).active, null);
    assert.deepEqual(await readdir(paths.versionsDir), []);
  });

  it('clears leftovers from an interrupted download on start', async () => {
    await mkdir(path.join(paths.versionsDir, '0.2.1.tmp'), { recursive: true });
    await mkdir(paths.downloadsDir, { recursive: true });
    await writeFile(path.join(paths.downloadsDir, 'partial.tar.gz'), 'x');
    await makeUpdater({ releases: [], system: fakeSystem() }).start();
    assert.deepEqual(await readdir(paths.versionsDir), []);
    assert.deepEqual(await readdir(paths.downloadsDir), []);
  });
});

describe('reconcileAfterRestart', () => {
  it('undoes an update that a restart interrupted', async () => {
    await mkdir(path.join(paths.versionsDir, '0.2.2'), { recursive: true });
    await writeState(paths, {
      ...emptyState(),
      active: { version: '0.2.1', runtime: 3 },
      trial: {
        version: '0.2.2',
        runtime: 3,
        previous: { version: '0.2.1', runtime: 3 },
        backup: '/data/backups/pre-0.2.2.dump',
        startedAt: '2026-10-02T11:59:00.000Z',
      },
    });
    const system = fakeSystem();
    assert.equal(await reconcileAfterRestart({ paths, system, log: () => {} }), true);

    const state = await readState(paths);
    assert.deepEqual(state.active, { version: '0.2.1', runtime: 3 });
    assert.equal(state.trial, null);
    assert.match(state.lastResult.error, /interrupted by a restart/);
    assert.ok(
      system.calls.includes(
        'pg_restore --no-owner --exit-on-error -d reelcraft /data/backups/pre-0.2.2.dump',
      ),
    );
    assert.equal(existsSync(path.join(paths.versionsDir, '0.2.2')), false);
    JSON.parse(readFileSync(paths.stateFile, 'utf8'));
  });

  it('does nothing without a pending update', async () => {
    const system = fakeSystem();
    assert.equal(await reconcileAfterRestart({ paths, system, log: () => {} }), false);
    assert.deepEqual(system.calls, []);
  });
});
