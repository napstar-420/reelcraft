// Semantic version parsing and ordering for release versions (1.2.3 and
// 1.2.3-rc.1). Anything else, such as the "dev" or "ci-<sha>" versions of
// local builds, is not a release and never takes part in updates.

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;

/** Returns `{ major, minor, patch, prerelease }`, or null when `version` is
 * not a release version. */
export function parseVersion(version) {
  const match = typeof version === 'string' ? SEMVER.exec(version) : null;
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

export function isReleaseVersion(version) {
  return parseVersion(version) !== null;
}

function compareIdentifiers(a, b) {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) return Math.sign(Number(a) - Number(b));
  if (aNum) return -1;
  if (bNum) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Orders two release versions by semver precedence: -1, 0 or 1. Throws for
 * a non-release version, so callers must check with isReleaseVersion first. */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`not a release version: ${pa ? b : a}`);
  for (const key of ['major', 'minor', 'patch']) {
    if (pa[key] !== pb[key]) return Math.sign(pa[key] - pb[key]);
  }
  // A version without a prerelease ranks above the same version with one.
  if (pa.prerelease.length === 0 || pb.prerelease.length === 0) {
    return Math.sign(pb.prerelease.length - pa.prerelease.length);
  }
  for (let i = 0; i < Math.max(pa.prerelease.length, pb.prerelease.length); i++) {
    if (pa.prerelease[i] === undefined) return -1;
    if (pb.prerelease[i] === undefined) return 1;
    const order = compareIdentifiers(pa.prerelease[i], pb.prerelease[i]);
    if (order !== 0) return order;
  }
  return 0;
}

export function isNewer(candidate, than) {
  return compareVersions(candidate, than) > 0;
}
