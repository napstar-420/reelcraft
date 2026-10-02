#!/usr/bin/env node
// The update agent: a root-owned service that checks GitHub for new releases
// and installs them when the app asks. It listens on a Unix socket that only
// root and the reelcraft group can open; the API relays the user's requests.
//
//   GET  /status            what runs now, the newest release, install progress
//   POST /check             look for a new release now
//   POST /install {version} install that release in the background
//
// With --reconcile it instead undoes an update a container restart
// interrupted, then exits (run once at boot, before migrations).
import { chmod, chown, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import {
  createGitHubClient,
  archName,
  DEFAULT_UPDATE_API,
  DEFAULT_UPDATE_REPO,
} from './releases.mjs';
import { PUBLIC_KEY_FILE, readImageInfo, updaterPaths } from './state.mjs';
import { createSystem } from './system.mjs';
import { createUpdater, reconcileAfterRestart, TRIAL_TIMEOUT_MS, UpdateError } from './updater.mjs';

const CHECK_INTERVAL_MS = 6 * 60 * 60_000;
const env = process.env;
const log = (message) => console.log(`reelcraft-updater: ${message}`);
const paths = updaterPaths(env.REELCRAFT_DATA_DIR);
const system = createSystem();

if (process.argv.includes('--reconcile')) {
  await reconcileAfterRestart({ paths, system, log, imageVersion: readImageInfo().version });
  process.exit(0);
}

const image = readImageInfo();
const socketPath = env.REELCRAFT_UPDATER_SOCKET ?? '/run/reelcraft/updater.sock';
const owner =
  env.REELCRAFT_UID && env.REELCRAFT_GID
    ? { uid: Number(env.REELCRAFT_UID), gid: Number(env.REELCRAFT_GID) }
    : null;

const updater = createUpdater({
  paths,
  image,
  github: createGitHubClient({
    api: env.REELCRAFT_UPDATE_API || DEFAULT_UPDATE_API,
    repo: env.REELCRAFT_UPDATE_REPO || DEFAULT_UPDATE_REPO,
    userAgent: `reelcraft-updater/${image.version}`,
  }),
  publicKey: await readFile(PUBLIC_KEY_FILE, 'utf8'),
  arch: archName(),
  system,
  owner,
  enabled: (env.REELCRAFT_UPDATES ?? 'on').toLowerCase() !== 'off',
  trialTimeoutMs: Number(env.REELCRAFT_UPDATE_TRIAL_TIMEOUT_SEC) * 1000 || TRIAL_TIMEOUT_MS,
  log,
});

await updater.start();

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new UpdateError('request too large', 413);
  }
  return raw ? JSON.parse(raw) : {};
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/status') {
      return send(res, 200, await updater.getStatus());
    }
    if (req.method === 'POST' && req.url === '/check') {
      await updater.check();
      return send(res, 200, await updater.getStatus());
    }
    if (req.method === 'POST' && req.url === '/install') {
      const { version } = await readBody(req);
      await updater.startInstall(version);
      return send(res, 202, await updater.getStatus());
    }
    send(res, 404, { message: 'not found' });
  } catch (err) {
    const status = err instanceof UpdateError ? err.status : 500;
    if (status === 500) log(`request failed: ${err.stack ?? err}`);
    send(res, status, { message: err.message });
  }
});

await rm(socketPath, { force: true });
server.listen(socketPath, async () => {
  await chmod(socketPath, 0o660);
  if (owner) await chown(socketPath, 0, owner.gid);
  log(`listening on ${socketPath} (image ${image.version}, runtime ${image.runtime})`);
});

const scheduledCheck = () => updater.check().catch(() => {});
setTimeout(scheduledCheck, 30_000);
setInterval(scheduledCheck, CHECK_INTERVAL_MS);

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
