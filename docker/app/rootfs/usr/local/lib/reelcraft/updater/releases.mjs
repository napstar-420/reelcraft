// Finds the newest release on GitHub and verifies its signed manifest. Only a
// manifest signed by the key baked into the image is ever trusted; release
// notes and asset listings are used for display and lookup only.
import { verifyManifest } from './signing.mjs';
import { compareVersions, isNewer, isReleaseVersion } from './versions.mjs';

/** Bumped when the agent learns something a manifest can require
 * (`minUpdaterVersion`); older agents then ask for a new image instead. */
export const UPDATER_VERSION = 1;

export const DEFAULT_UPDATE_API = 'https://api.github.com';
export const DEFAULT_UPDATE_REPO = 'napstar-420/reelcraft';

export function manifestAssetName(version) {
  return `reelcraft-${version}.manifest.json`;
}

/** Docker's name for the CPU architecture this process runs on. */
export function archName(nodeArch = process.arch) {
  const arch = { x64: 'amd64', arm64: 'arm64' }[nodeArch];
  if (!arch) throw new Error(`unsupported architecture ${nodeArch}`);
  return arch;
}

function findAsset(release, name) {
  return (release.assets ?? []).find((asset) => asset.name === name) ?? null;
}

/** The newest published, non-prerelease release that carries a signed
 * manifest, as `{ version, release }`, or null when there is none. */
export function pickLatestRelease(releases) {
  let best = null;
  for (const release of releases) {
    if (release.draft || release.prerelease) continue;
    const version = /^v(.+)$/.exec(release.tag_name ?? '')?.[1];
    if (!isReleaseVersion(version)) continue;
    const manifest = manifestAssetName(version);
    if (!findAsset(release, manifest) || !findAsset(release, `${manifest}.sig`)) continue;
    if (!best || compareVersions(version, best.version) > 0) best = { version, release };
  }
  return best;
}

const BUNDLE_FILE = (version, arch) => `reelcraft-app-${version}-linux-${arch}.tar.gz`;

/** Checks a verified manifest's contents and returns this architecture's
 * bundle entry. Throws with a message fit to show the user. */
export function validateManifest(manifest, { version, arch }) {
  const fail = (why) => {
    throw new Error(`release manifest for ${version} is invalid: ${why}`);
  };
  if (manifest?.schema !== 1) fail(`unsupported schema ${manifest?.schema}`);
  if (manifest.version !== version) fail(`it is for version ${manifest.version}`);
  if (manifest.tag !== `v${version}`) fail(`it is for tag ${manifest.tag}`);
  if (!Number.isInteger(manifest.runtime) || manifest.runtime < 1) fail('bad runtime');
  if (manifest.minUpdaterVersion != null && !Number.isInteger(manifest.minUpdaterVersion)) {
    fail('bad minUpdaterVersion');
  }
  const bundle = manifest.bundles?.[`linux/${arch}`];
  if (!bundle) fail(`no app bundle for linux/${arch}`);
  if (bundle.file !== BUNDLE_FILE(version, arch)) fail(`unexpected bundle name ${bundle.file}`);
  if (!/^[0-9a-f]{64}$/.test(bundle.sha256 ?? '')) fail('bad bundle checksum');
  if (!Number.isInteger(bundle.bytes) || bundle.bytes <= 0) fail('bad bundle size');
  return bundle;
}

/** Whether this image can install the release without being replaced. */
export function needsNewImage(manifest, image) {
  return (
    manifest.runtime > image.runtime ||
    (manifest.minUpdaterVersion != null && manifest.minUpdaterVersion > UPDATER_VERSION)
  );
}

export function createGitHubClient({
  api = DEFAULT_UPDATE_API,
  repo = DEFAULT_UPDATE_REPO,
  userAgent = 'reelcraft-updater',
  fetchImpl = fetch,
  timeoutMs = 30_000,
} = {}) {
  const request = async (url, accept) => {
    const res = await fetchImpl(url, {
      headers: { accept, 'user-agent': userAgent },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`GET ${url} failed: HTTP ${res.status}`);
    return res;
  };
  const base = `${api.replace(/\/+$/, '')}/repos/${repo}`;
  return {
    async listReleases() {
      return (await request(`${base}/releases?per_page=10`, 'application/vnd.github+json')).json();
    },
    async getRelease(tag) {
      const url = `${base}/releases/tags/${encodeURIComponent(tag)}`;
      return (await request(url, 'application/vnd.github+json')).json();
    },
    async downloadBytes(url) {
      return Buffer.from(await (await request(url, 'application/octet-stream')).arrayBuffer());
    },
    /** Starts a download and returns the response, for streaming large files. */
    async download(url) {
      const res = await fetchImpl(url, {
        headers: { accept: 'application/octet-stream', 'user-agent': userAgent },
        redirect: 'follow',
      });
      if (!res.ok || !res.body) throw new Error(`GET ${url} failed: HTTP ${res.status}`);
      return res;
    },
  };
}

/** Downloads a release's manifest and signature and returns the manifest
 * only if the signature verifies against the image's public key. */
export async function fetchVerifiedManifest({ github, release, version, publicKey, arch }) {
  const name = manifestAssetName(version);
  const manifestAsset = findAsset(release, name);
  const sigAsset = findAsset(release, `${name}.sig`);
  if (!manifestAsset || !sigAsset) throw new Error(`release ${version} has no signed manifest`);
  const [bytes, sig] = await Promise.all([
    github.downloadBytes(manifestAsset.browser_download_url),
    github.downloadBytes(sigAsset.browser_download_url),
  ]);
  if (!verifyManifest(bytes, sig.toString('utf8'), publicKey)) {
    throw new Error(
      `the release manifest for ${version} is not signed by the Reelcraft release key`,
    );
  }
  const manifest = JSON.parse(bytes.toString('utf8'));
  const bundle = validateManifest(manifest, { version, arch });
  const bundleAsset = findAsset(release, bundle.file);
  if (!bundleAsset) throw new Error(`release ${version} is missing ${bundle.file}`);
  return { manifest, bundle, bundleUrl: bundleAsset.browser_download_url };
}

/** Looks up the newest release and describes it relative to what runs now.
 * Returns null when there is no release at all. */
export async function checkForUpdate({ github, image, current, publicKey, arch }) {
  const latest = pickLatestRelease(await github.listReleases());
  if (!latest) return null;
  const newer = isReleaseVersion(current) && isNewer(latest.version, current);
  const info = {
    version: latest.version,
    tag: latest.release.tag_name,
    url: latest.release.html_url ?? null,
    notes: typeof latest.release.body === 'string' ? latest.release.body : '',
    publishedAt: latest.release.published_at ?? null,
    newer,
    runtime: null,
    needsImage: false,
  };
  // Only a newer release is downloaded and verified; that is all the app
  // needs to decide between "Update" and "update the image".
  if (newer) {
    const { manifest } = await fetchVerifiedManifest({
      github,
      release: latest.release,
      version: latest.version,
      publicKey,
      arch,
    });
    info.runtime = manifest.runtime;
    info.needsImage = needsNewImage(manifest, image);
  }
  return info;
}
