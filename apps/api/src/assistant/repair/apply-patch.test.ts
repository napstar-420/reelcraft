import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { applyPatch, cleanGitEnv } from './apply-patch';

const SHARED = 'packages/shared/x.ts';
const API = 'apps/api/y.ts';

/** A checkout with a shared and an API file, a patch changing both, and an unrelated local edit. */
function checkout() {
  const root = mkdtempSync(join(tmpdir(), 'repair-apply-'));
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
      cwd: root,
      env: cleanGitEnv(),
    });
  mkdirSync(join(root, 'packages/shared'), { recursive: true });
  mkdirSync(join(root, 'apps/api'), { recursive: true });
  writeFileSync(join(root, SHARED), 'a\n');
  writeFileSync(join(root, API), 'b\n');
  writeFileSync(join(root, 'local.ts'), 'mine\n');
  git('init', '-q');
  git('add', '.');
  git('commit', '-qm', 'base');
  writeFileSync(join(root, SHARED), 'a fixed\n');
  writeFileSync(join(root, API), 'b fixed\n');
  const patchPath = join(root, '..', `${root.split('/').pop()}.patch`);
  writeFileSync(patchPath, git('diff'));
  git('checkout', '-q', '.');
  writeFileSync(join(root, 'local.ts'), 'mine, edited\n');
  const read = (file: string) => readFileSync(join(root, file), 'utf8');
  return { root, patchPath, read };
}

describe('cleanGitEnv', () => {
  it("drops git's repository variables and keeps the rest", () => {
    expect(cleanGitEnv({ GIT_DIR: '/x', GIT_INDEX_FILE: '/i', PATH: '/bin' })).toEqual({
      PATH: '/bin',
    });
  });
});

describe('applyPatch', () => {
  it('lands shared first, builds it, then the rest', async () => {
    const c = checkout();
    const buildShared = vi.fn(async () => {
      expect(c.read(SHARED)).toBe('a fixed\n');
      expect(c.read(API)).toBe('b\n');
    });
    expect(await applyPatch({ ...c, shared: true, buildShared })).toBe(true);
    expect(buildShared).toHaveBeenCalledOnce();
    expect(c.read(API)).toBe('b fixed\n');
    expect(c.read('local.ts')).toBe('mine, edited\n');
  });

  it('reverses the shared part when the build fails, keeping local changes', async () => {
    const c = checkout();
    const buildShared = vi.fn(async () => {
      throw new Error('tsc failed');
    });
    await expect(applyPatch({ ...c, shared: true, buildShared })).rejects.toThrow(
      'none of it was left there',
    );
    expect(c.read(SHARED)).toBe('a\n');
    expect(c.read(API)).toBe('b\n');
    expect(c.read('local.ts')).toBe('mine, edited\n');
  });

  it('carries on after a restart left only the shared part applied', async () => {
    const c = checkout();
    execFileSync('git', ['apply', '--include=packages/shared/*', c.patchPath], {
      cwd: c.root,
      env: cleanGitEnv(),
    });
    const buildShared = vi.fn(async () => undefined);
    expect(await applyPatch({ ...c, shared: true, buildShared })).toBe(true);
    expect(c.read(SHARED)).toBe('a fixed\n');
    expect(c.read(API)).toBe('b fixed\n');
  });

  it('applies nothing when the checkout has its own changes there', async () => {
    const c = checkout();
    writeFileSync(join(c.root, API), 'b, edited here\n');
    expect(await applyPatch({ ...c, shared: true, buildShared: vi.fn() })).toBe(false);
    expect(c.read(SHARED)).toBe('a\n');
    expect(c.read(API)).toBe('b, edited here\n');
  });

  it('is done when applied before, rebuilding shared', async () => {
    const c = checkout();
    execFileSync('git', ['apply', c.patchPath], { cwd: c.root, env: cleanGitEnv() });
    const buildShared = vi.fn(async () => undefined);
    expect(await applyPatch({ ...c, shared: true, buildShared })).toBe(true);
    expect(buildShared).toHaveBeenCalledOnce();
  });
});
