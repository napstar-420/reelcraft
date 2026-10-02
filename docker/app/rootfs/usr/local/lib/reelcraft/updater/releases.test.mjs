import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  archName,
  checkForUpdate,
  fetchVerifiedManifest,
  needsNewImage,
  pickLatestRelease,
  validateManifest,
} from './releases.mjs';
import { fakeGitHub, keypair, makeRelease } from './testing.mjs';

const keys = keypair();
const image = { version: '0.2.0', runtime: 3 };

describe('pickLatestRelease', () => {
  it('takes the highest signed, published, non-prerelease version', () => {
    const releases = [
      makeRelease({ version: '0.2.1', keys }),
      makeRelease({ version: '0.10.0', keys }),
      makeRelease({ version: '0.11.0', keys, draft: true }),
      makeRelease({ version: '0.12.0-rc.1', keys, prerelease: true }),
      { tag_name: 'v0.13.0', draft: false, prerelease: false, assets: [] },
      { tag_name: 'nightly', draft: false, prerelease: false, assets: [] },
    ];
    assert.equal(pickLatestRelease(releases).version, '0.10.0');
    assert.equal(pickLatestRelease([]), null);
  });
});

describe('validateManifest', () => {
  const manifest = () =>
    JSON.parse(makeRelease({ version: '1.0.0', keys }).files['reelcraft-1.0.0.manifest.json']);

  it('returns the bundle for this architecture', () => {
    assert.equal(validateManifest(manifest(), { version: '1.0.0', arch: 'amd64' }).bytes, 12);
  });

  it('rejects a manifest for another version, tag or architecture', () => {
    assert.throws(
      () => validateManifest(manifest(), { version: '1.0.1', arch: 'amd64' }),
      /version 1.0.0/,
    );
    assert.throws(
      () => validateManifest(manifest(), { version: '1.0.0', arch: 'arm64' }),
      /linux\/arm64/,
    );
    const wrongTag = { ...manifest(), tag: 'v9.9.9' };
    assert.throws(
      () => validateManifest(wrongTag, { version: '1.0.0', arch: 'amd64' }),
      /tag v9.9.9/,
    );
    const badName = manifest();
    badName.bundles['linux/amd64'].file = '../../etc/passwd';
    assert.throws(
      () => validateManifest(badName, { version: '1.0.0', arch: 'amd64' }),
      /bundle name/,
    );
  });
});

describe('needsNewImage', () => {
  it('asks for a new image when the runtime or updater is too old', () => {
    assert.equal(needsNewImage({ runtime: 3, minUpdaterVersion: 1 }, image), false);
    assert.equal(needsNewImage({ runtime: 4, minUpdaterVersion: 1 }, image), true);
    assert.equal(needsNewImage({ runtime: 3, minUpdaterVersion: 2 }, image), true);
    assert.equal(needsNewImage({ runtime: 3, minUpdaterVersion: null }, image), false);
  });
});

describe('fetchVerifiedManifest', () => {
  it('accepts a manifest signed with the release key', async () => {
    const release = makeRelease({ version: '0.2.1', keys, runtime: 3 });
    const github = fakeGitHub([release]);
    const { manifest, bundleUrl } = await fetchVerifiedManifest({
      github,
      release,
      version: '0.2.1',
      publicKey: keys.publicPem,
      arch: 'amd64',
    });
    assert.equal(manifest.runtime, 3);
    assert.match(bundleUrl, /reelcraft-app-0\.2\.1-linux-amd64\.tar\.gz$/);
  });

  it('rejects a manifest signed with another key', async () => {
    const release = makeRelease({ version: '0.2.1', keys: keypair() });
    await assert.rejects(
      fetchVerifiedManifest({
        github: fakeGitHub([release]),
        release,
        version: '0.2.1',
        publicKey: keys.publicPem,
        arch: 'amd64',
      }),
      /not signed by the Reelcraft release key/,
    );
  });

  it('rejects a manifest changed after signing', async () => {
    const release = makeRelease({ version: '0.2.1', keys });
    const name = 'reelcraft-0.2.1.manifest.json';
    release.files[name] = Buffer.from(
      release.files[name].toString().replace('"runtime": 1', '"runtime": 2'),
    );
    await assert.rejects(
      fetchVerifiedManifest({
        github: fakeGitHub([release]),
        release,
        version: '0.2.1',
        publicKey: keys.publicPem,
        arch: 'amd64',
      }),
      /not signed/,
    );
  });
});

describe('checkForUpdate', () => {
  const check = (releases, current = '0.2.0') =>
    checkForUpdate({
      github: fakeGitHub(releases),
      image,
      current,
      publicKey: keys.publicPem,
      arch: 'amd64',
    });

  it('describes a newer compatible release', async () => {
    const latest = await check([makeRelease({ version: '0.2.1', keys, runtime: 3 })]);
    assert.equal(latest.version, '0.2.1');
    assert.equal(latest.newer, true);
    assert.equal(latest.needsImage, false);
    assert.equal(latest.notes, 'Notes for 0.2.1');
  });

  it('flags a release that needs a newer image', async () => {
    const latest = await check([makeRelease({ version: '0.3.0', keys, runtime: 4 })]);
    assert.equal(latest.needsImage, true);
  });

  it('reports no update when already current', async () => {
    const latest = await check([makeRelease({ version: '0.2.0', keys })]);
    assert.equal(latest.newer, false);
  });
});

describe('archName', () => {
  it("maps Node's names to Docker's", () => {
    assert.equal(archName('x64'), 'amd64');
    assert.equal(archName('arm64'), 'arm64');
    assert.throws(() => archName('ia32'), /unsupported/);
  });
});
