import { describe, expect, it } from 'vitest';
import { PackageManifest, PackagePipeline, slotKeyOf, slotRef } from './package.dto';

const sha = 'a'.repeat(64);
const manifest = {
  format: 'reelcraft.package',
  formatVersion: 1,
  package: { id: 'pkg1', version: '1.2' },
  author: { label: 'local', publicKey: 'pem', fingerprint: 'ab'.repeat(16) },
  exportedBy: '0.4.1',
  minReelcraft: '0.4.1',
  meta: { name: 'Shorts' },
  files: [{ path: 'media/x.png', sha256: sha, bytes: 3, mime: 'image/png' }],
  slots: [],
  requires: { capabilities: ['text.generate'], providers: [] },
};

describe('PackageManifest', () => {
  it('accepts a valid manifest and fills defaults', () => {
    const parsed = PackageManifest.parse(manifest);
    expect(parsed.meta.tags).toEqual([]);
  });

  it.each(['../x', '/abs/x', 'a//b', 'a\\b', './x'])('rejects the unsafe path %s', (path) => {
    const files = [{ path, sha256: sha, bytes: 1, mime: 'image/png' }];
    expect(PackageManifest.safeParse({ ...manifest, files }).success).toBe(false);
  });

  it('rejects a foreign format and a non-hex hash', () => {
    expect(PackageManifest.safeParse({ ...manifest, format: 'other' }).success).toBe(false);
    const files = [{ path: 'a', sha256: 'zz', bytes: 1, mime: 'image/png' }];
    expect(PackageManifest.safeParse({ ...manifest, files }).success).toBe(false);
  });
});

describe('PackagePipeline', () => {
  it('has no budget', () => {
    const parsed = PackagePipeline.parse({ graph: [], budget: { runCapUsd: 99 } });
    expect(parsed).not.toHaveProperty('budget');
  });
});

describe('slots', () => {
  it('round-trips a slot placeholder', () => {
    expect(slotKeyOf(slotRef('host'))).toBe('host');
    expect(slotKeyOf('01HABC')).toBeNull();
  });
});
