// Release versions only (1.2.3, 1.2.3-rc.1). Builds of `dev` or `ci-<sha>` are
// not releases and never fail a minimum-version check.
// Port of docker/app/rootfs/usr/local/lib/reelcraft/updater/versions.mjs,
// which the API cannot import.
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;

interface Parsed {
  core: [number, number, number];
  prerelease: string[];
}

function parse(version: string): Parsed | null {
  const m = SEMVER.exec(version);
  if (!m) return null;
  return {
    core: [Number(m[1]), Number(m[2]), Number(m[3])],
    prerelease: m[4] ? m[4].split('.') : [],
  };
}

export function isReleaseVersion(version: string): boolean {
  return parse(version) !== null;
}

function compareIdentifiers(a: string, b: string): number {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) return Math.sign(Number(a) - Number(b));
  if (aNum) return -1;
  if (bNum) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Semver precedence: -1, 0 or 1. Both must be release versions. */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) throw new Error(`not a release version: ${pa ? b : a}`);
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return Math.sign(pa.core[i]! - pb.core[i]!);
  }
  if (pa.prerelease.length === 0 || pb.prerelease.length === 0) {
    return Math.sign(pb.prerelease.length - pa.prerelease.length);
  }
  for (let i = 0; i < Math.max(pa.prerelease.length, pb.prerelease.length); i++) {
    if (pa.prerelease[i] === undefined) return -1;
    if (pb.prerelease[i] === undefined) return 1;
    const order = compareIdentifiers(pa.prerelease[i]!, pb.prerelease[i]!);
    if (order !== 0) return order;
  }
  return 0;
}

/** Whether a running `current` build can read something that needs at least
 * `minimum`. Non-release builds (`dev`, `ci-…`) are assumed new enough. */
export function satisfiesMinimum(current: string, minimum: string): boolean {
  if (!isReleaseVersion(current) || !isReleaseVersion(minimum)) return true;
  return compareVersions(current, minimum) >= 0;
}
