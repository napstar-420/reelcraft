import { execFile } from 'node:child_process';
import { access, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/** The variables that tie git to one repository: `git rev-parse --local-env-vars` (git 2.56),
 * less the config overrides (GIT_CONFIG_PARAMETERS, GIT_CONFIG_COUNT with its KEY_n/VALUE_n),
 * which carry settings such as identity and sign-in and point at no repository. */
const REPOSITORY_VARS: ReadonlySet<string> = new Set([
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG',
  'GIT_OBJECT_DIRECTORY',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE',
  'GIT_PREFIX',
  'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
]);

/**
 * The environment without git's repository variables. Repair commands name their folder with
 * `cwd`; an inherited GIT_DIR (set when running inside a git hook) would point them at another
 * repository instead. The rest (GIT_SSH_COMMAND, GIT_ASKPASS, GIT_AUTHOR_*…) stays, so pushing
 * and committing work as they do for the user.
 */
export function cleanGitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !REPOSITORY_VARS.has(key)));
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
 * shared part. `sharedMarkerPath` records that this repair applied the shared part, so shared
 * edits the checkout already had (the same change, made another way) are never reversed.
 */
export async function applyPatch(input: {
  root: string;
  patchPath: string;
  shared: boolean;
  sharedMarkerPath: string;
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
  const marker = input.sharedMarkerPath;
  // reverses the shared part this repair applied, then rebuilds so the build matches the sources
  const undoShared = async () => {
    await git(['apply', '--reverse', SHARED, patchPath]).catch((error: unknown) =>
      input.onUndoFailed?.(error),
    );
    await rm(marker, { force: true });
    await buildShared().catch((error: unknown) => input.onUndoFailed?.(error));
  };
  const sharedIn = await ok(['apply', '--check', '--reverse', SHARED, patchPath]);
  const owned = await access(marker).then(
    () => true,
    () => false,
  );
  if (sharedIn && !owned) {
    // the checkout already has these shared changes: only the rest is the repair's to add
    if (!(await ok(['apply', '--check', REST, patchPath]))) return false;
    await buildShared();
    await git(['apply', REST, patchPath]);
    return true;
  }
  // sharedIn here means a restart between the steps left this repair's shared part applied
  if (!(await ok(['apply', '--check', ...(sharedIn ? [REST] : []), patchPath]))) {
    if (sharedIn) await undoShared();
    return false;
  }
  if (!sharedIn) {
    await writeFile(marker, ''); // before applying: a crash in between leaves nothing to reverse
    await git(['apply', SHARED, patchPath]);
  }
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
