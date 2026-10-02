#!/usr/bin/env node
// Decides which app bundle the container runs: an update on trial, an
// installed update, or the bundle that shipped in the image. The api and
// migrate services evaluate its output before starting:
//
//   eval "$(node /usr/local/lib/reelcraft/updater/select-app.mjs)"
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readImageInfo, readStateSync, updaterPaths, versionDir } from './state.mjs';
import { isNewer, isReleaseVersion } from './versions.mjs';

/** Whether an installed update may run on this image: it must be newer than
 * the image's own bundle (otherwise a newer image was pulled and wins) and
 * need no newer runtime than the image provides. */
export function installedUsable(installed, image) {
  return (
    installed != null &&
    isReleaseVersion(image.version) &&
    isReleaseVersion(installed.version) &&
    isNewer(installed.version, image.version) &&
    installed.runtime <= image.runtime
  );
}

export function selectApp({ image, state, paths, exists = existsSync }) {
  const installed = (entry, source) => {
    const appDir = versionDir(paths, entry.version);
    if (!exists(path.join(appDir, 'apps/api/dist/main.js'))) return null;
    return { source, version: entry.version, runtime: entry.runtime, appDir };
  };
  if (state.trial && installedUsable(state.trial, image)) {
    const trial = installed(state.trial, 'trial');
    if (trial) return trial;
  }
  if (state.active && installedUsable(state.active, image)) {
    const active = installed(state.active, 'active');
    if (active) return active;
  }
  return { source: 'image', version: image.version, runtime: image.runtime, appDir: image.appDir };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function toShellExports(selection) {
  return [
    `export REELCRAFT_APP_DIR=${shellQuote(selection.appDir)}`,
    `export REELCRAFT_VERSION=${shellQuote(selection.version)}`,
    `export WEB_DIST_DIR=${shellQuote(path.join(selection.appDir, 'apps/web/dist'))}`,
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const image = readImageInfo();
  const paths = updaterPaths(process.env.REELCRAFT_DATA_DIR);
  let state;
  try {
    state = readStateSync(paths);
  } catch (err) {
    // A damaged state file must never stop the app from starting.
    console.error(`reelcraft: ignoring unreadable ${paths.stateFile}: ${err.message}`);
    state = { active: null, trial: null };
  }
  const selection = selectApp({ image, state, paths });
  if (selection.source !== 'image') {
    console.error(`reelcraft: running ${selection.source} update ${selection.version}`);
  }
  console.log(toShellExports(selection));
}
