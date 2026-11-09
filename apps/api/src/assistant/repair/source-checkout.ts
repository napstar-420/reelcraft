import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type SourceCheckout = { root: string } | { unavailable: string };

let cached: Promise<SourceCheckout> | undefined;

/**
 * The git checkout this API runs from, which engine repair patches. Only when Reelcraft runs from
 * source (`pnpm dev`): the Docker image has a compiled bundle and no source to fix.
 */
export function sourceCheckout(): Promise<SourceCheckout> {
  cached ??= find();
  return cached;
}

async function find(): Promise<SourceCheckout> {
  if (process.env.NODE_ENV === 'production') {
    return {
      unavailable:
        'Reelcraft is running from its built image, which has no source code to fix. Engine repair needs Reelcraft running from a git checkout (pnpm dev).',
    };
  }
  try {
    const { stdout } = await run('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd() });
    const root = stdout.trim();
    await access(join(root, 'apps', 'api', 'src'));
    return { root };
  } catch {
    return {
      unavailable:
        'Reelcraft is not running from a git checkout of its source, so there is nothing to fix. Engine repair needs pnpm dev in a clone of the Reelcraft repository.',
    };
  }
}
