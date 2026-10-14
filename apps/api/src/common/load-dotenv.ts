import path from 'node:path';
import { existsSync } from 'node:fs';
import { config } from 'dotenv';

/**
 * The monorepo root: the nearest folder at or above `startDir` that holds
 * `pnpm-workspace.yaml`, or null when there is none (the self-hosted image
 * ships the app bundle, which has one, but not the rest of the repo).
 */
export function findRepoRoot(startDir: string = __dirname): string | null {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Loads the monorepo-root `.env`, walking up from `startDir` until
 * `pnpm-workspace.yaml` is found. A bare `dotenv/config` reads from
 * `process.cwd()`, which pnpm sets to the package directory under
 * `--filter` (e.g. `apps/api`) — silently missing the repo-root `.env`
 * that `README.md`'s fresh-clone setup relies on.
 */
export function loadRootEnv(startDir: string = __dirname): void {
  const root = findRepoRoot(startDir);
  if (root) config({ path: path.join(root, '.env') });
}
