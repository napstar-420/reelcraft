// Test helpers: signed fake releases served by an in-memory GitHub client.
import { createHash, generateKeyPairSync } from 'node:crypto';
import { signManifest } from './signing.mjs';
import { manifestAssetName } from './releases.mjs';

export function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

/** Builds a signed release. `edit` may change the manifest before signing. */
export function makeRelease({ version, runtime = 1, arch = 'amd64', bundle, keys, edit, ...rest }) {
  const bundleBytes = bundle ?? Buffer.from(`bundle ${version}`);
  const file = `reelcraft-app-${version}-linux-${arch}.tar.gz`;
  const manifest = {
    schema: 1,
    version,
    tag: `v${version}`,
    runtime,
    minUpdaterVersion: 1,
    releasedAt: '2026-10-01T00:00:00.000Z',
    bundles: {
      [`linux/${arch}`]: {
        file,
        sha256: createHash('sha256').update(bundleBytes).digest('hex'),
        bytes: bundleBytes.length,
      },
    },
    images: {},
  };
  edit?.(manifest);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const name = manifestAssetName(version);
  const files = {
    [name]: manifestBytes,
    [`${name}.sig`]: Buffer.from(signManifest(manifestBytes, keys.privatePem)),
    [file]: bundleBytes,
  };
  return {
    tag_name: `v${version}`,
    html_url: `https://github.com/example/reelcraft/releases/tag/v${version}`,
    body: `Notes for ${version}`,
    published_at: '2026-10-01T00:00:00Z',
    draft: false,
    prerelease: false,
    ...rest,
    assets: Object.keys(files).map((assetName) => ({
      name: assetName,
      browser_download_url: `https://downloads.example/${version}/${assetName}`,
    })),
    files,
  };
}

/** An in-memory stand-in for createGitHubClient(). */
export function fakeGitHub(releases) {
  const fileFor = (url) => {
    for (const release of releases) {
      const asset = release.assets.find((a) => a.browser_download_url === url);
      if (asset) return release.files[asset.name];
    }
    throw new Error(`GET ${url} failed: HTTP 404`);
  };
  const strip = (release) => {
    const copy = { ...release };
    delete copy.files;
    return copy;
  };
  return {
    downloads: [],
    async listReleases() {
      return releases.map(strip);
    },
    async getRelease(tag) {
      const release = releases.find((r) => r.tag_name === tag);
      if (!release) throw new Error(`release ${tag} not found`);
      return strip(release);
    },
    async downloadBytes(url) {
      return fileFor(url);
    },
    async download(url) {
      this.downloads.push(url);
      const bytes = fileFor(url);
      return {
        body: (async function* () {
          for (let i = 0; i < bytes.length; i += 64) yield bytes.subarray(i, i + 64);
        })(),
      };
    },
  };
}
