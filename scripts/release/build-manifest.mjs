#!/usr/bin/env node
// Writes the release manifest that the in-app updater reads: which bundle to
// download for each architecture, its checksum, and the image runtime it needs.
//
// Usage: build-manifest.mjs --version 1.2.3 --tag v1.2.3 --runtime 1 \
//          --bundles-dir dist/release --digest amd64=sha256:... --digest arm64=sha256:... \
//          --out dist/release/reelcraft-1.2.3.manifest.json
import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    version: { type: 'string' },
    tag: { type: 'string' },
    runtime: { type: 'string' },
    'bundles-dir': { type: 'string' },
    digest: { type: 'string', multiple: true, default: [] },
    out: { type: 'string' },
  },
});

for (const name of ['version', 'tag', 'runtime', 'bundles-dir', 'out']) {
  if (!values[name]) throw new Error(`--${name} is required`);
}
const runtime = Number(values.runtime);
if (!Number.isInteger(runtime) || runtime < 1)
  throw new Error('--runtime must be a positive integer');

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

const bundlePattern = new RegExp(
  `^reelcraft-app-${values.version.replace(/\./g, '\\.')}-linux-(amd64|arm64)\\.tar\\.gz$`,
);
const bundles = {};
for (const file of readdirSync(values['bundles-dir']).sort()) {
  const match = bundlePattern.exec(file);
  if (!match) continue;
  const full = path.join(values['bundles-dir'], file);
  bundles[`linux/${match[1]}`] = { file, sha256: await sha256(full), bytes: statSync(full).size };
}
if (Object.keys(bundles).length === 0)
  throw new Error(`no app bundles for ${values.version} found`);

const images = {};
for (const entry of values.digest) {
  const [arch, digest] = entry.split('=');
  if (!arch || !/^sha256:[0-9a-f]{64}$/.test(digest ?? ''))
    throw new Error(`bad --digest ${entry}`);
  images[`linux/${arch}`] = digest;
}

const manifest = {
  schema: 1,
  version: values.version,
  tag: values.tag,
  runtime,
  minUpdaterVersion: null,
  releasedAt: new Date().toISOString(),
  bundles,
  images,
};
writeFileSync(values.out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${values.out}`);
