import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/**
 * The environment without git's repository variables (GIT_DIR, GIT_INDEX_FILE, GIT_WORK_TREE…).
 * Repair commands name their folder with `cwd`; an inherited GIT_DIR (set when running inside a
 * git hook) would point them at another repository instead.
 */
export function cleanGitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('GIT_')));
}

const exec = (command: string, args: string[], options: { cwd: string }) =>
  execFileP(command, args, { ...options, env: cleanGitEnv() });

const SHARED = '--include=packages/shared/*';
const REST = '--exclude=packages/shared/*';

/** What a failed command printed, else its message. */
function output(error: unknown): string {
  const e = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
  const text = [e.stdout, e.stderr].filter((s) => typeof s === 'string' && s.trim()).join('\n');
  return (text || String(e.message ?? error)).trim().slice(-2_000);
}

/**
 * Applies an engine repair's patch to the running checkout, uncommitted. False when it doesn't
 * apply cleanly (the checkout has its own changes there). With `shared`, `packages/shared` goes
 * first and is built before the rest lands, so the API reloads against the new shared build. It
 * lands as a unit: if the build or the rest fails, the shared part is reversed (only its own
 * hunks, so the checkout's other changes stay); a restart between the steps carries on from the
 * shared part.
 */
export async function applyPatch(input: {
  root: string;
  patchPath: string;
  shared: boolean;
  buildShared: () => Promise<void>;
  onUndoFailed?: (error: unknown) => void;
}): Promise<boolean> {
  const { patchPath, shared, buildShared } = input;
  const git = (args: string[]) => exec('git', args, { cwd: input.root });
  const ok = (args: string[]) =>
    git(args).then(
      () => true,
      () => false,
    );
  if (await ok(['apply', '--check', '--reverse', patchPath])) {
    // applied before a restart; the shared build may not have finished
    if (shared) await buildShared();
    return true;
  }
  if (!shared) {
    if (!(await ok(['apply', '--check', patchPath]))) return false;
    await git(['apply', patchPath]);
    return true;
  }
  const undoShared = () =>
    git(['apply', '--reverse', SHARED, patchPath]).catch((error: unknown) =>
      input.onUndoFailed?.(error),
    );
  // a restart between the steps left the shared part applied
  const sharedIn = await ok(['apply', '--check', '--reverse', SHARED, patchPath]);
  if (!(await ok(['apply', '--check', ...(sharedIn ? [REST] : []), patchPath]))) {
    if (sharedIn) await undoShared();
    return false;
  }
  if (!sharedIn) await git(['apply', SHARED, patchPath]);
  try {
    await buildShared();
    await git(['apply', REST, patchPath]);
  } catch (error) {
    await undoShared();
    throw new Error(
      `The fix could not be applied to your checkout, so none of it was left there: ${output(error)}`,
    );
  }
  return true;
}
