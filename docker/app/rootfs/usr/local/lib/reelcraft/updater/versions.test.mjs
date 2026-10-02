import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compareVersions, isNewer, isReleaseVersion, parseVersion } from './versions.mjs';

describe('release versions', () => {
  it('accepts release and prerelease versions only', () => {
    assert.equal(isReleaseVersion('1.2.3'), true);
    assert.equal(isReleaseVersion('0.2.0-rc.1'), true);
    for (const v of ['dev', 'ci-abc123', 'v1.2.3', '1.2', '01.2.3', '', undefined]) {
      assert.equal(isReleaseVersion(v), false, String(v));
    }
    assert.deepEqual(parseVersion('1.2.3-rc.1'), {
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ['rc', '1'],
    });
  });

  it('orders by semver precedence', () => {
    const ordered = [
      '0.1.1',
      '0.2.0-alpha',
      '0.2.0-alpha.1',
      '0.2.0-beta',
      '0.2.0-rc.2',
      '0.2.0-rc.10',
      '0.2.0',
      '0.10.0',
      '1.0.0',
    ];
    for (let i = 0; i < ordered.length - 1; i++) {
      assert.equal(compareVersions(ordered[i], ordered[i + 1]), -1, `${ordered[i]} < next`);
      assert.equal(compareVersions(ordered[i + 1], ordered[i]), 1, `${ordered[i + 1]} > prev`);
    }
    assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
    assert.equal(isNewer('0.1.10', '0.1.9'), true);
    assert.equal(isNewer('0.1.1', '0.1.1'), false);
  });

  it('refuses to compare non-release versions', () => {
    assert.throws(() => compareVersions('dev', '1.0.0'), /not a release version: dev/);
  });
});
