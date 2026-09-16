import path from 'node:path';
import { existsSync } from 'node:fs';
import { config } from 'dotenv';

/**
 * Loads the monorepo-root `.env`, walking up from `startDir` until
 * `pnpm-workspace.yaml` is found. A bare `dotenv/config` reads from
 * `process.cwd()`, which pnpm sets to the package directory under
 * `--filter` (e.g. `apps/api`) — silently missing the repo-root `.env`
 * that `README.md`'s fresh-clone setup relies on.
 */
export function loadRootEnv(startDir: string = __dirname): void {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      config({ path: path.join(dir, '.env') });
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}
