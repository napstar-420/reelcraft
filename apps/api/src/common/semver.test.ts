import { describe, expect, it } from 'vitest';
import { compareVersions, satisfiesMinimum } from './semver';

describe('semver', () => {
  it('orders releases and prereleases', () => {
    expect(compareVersions('0.4.1', '0.4.0')).toBe(1);
    expect(compareVersions('0.4.1', '0.10.0')).toBe(-1);
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBe(-1);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('checks a minimum, letting dev and ci builds through', () => {
    expect(satisfiesMinimum('0.4.1', '0.5.0')).toBe(false);
    expect(satisfiesMinimum('0.5.0', '0.5.0')).toBe(true);
    expect(satisfiesMinimum('dev', '9.9.9')).toBe(true);
    expect(satisfiesMinimum('ci-abc123', '9.9.9')).toBe(true);
  });
});
