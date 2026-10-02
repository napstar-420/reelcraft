#!/usr/bin/env node
// Signs a release manifest with RELEASE_SIGNING_KEY and writes <manifest>.sig.
// Verifies the result against the committed public key, so a mismatched key
// fails the release instead of shipping updates nobody can verify.
//
// Usage: RELEASE_SIGNING_KEY="$(cat key.pem)" sign-manifest.mjs <manifest.json>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPlaceholderPublicKey, signManifest, verifyManifest } from './signing.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicKeyPath =
  process.env.RELEASE_SIGNING_PUBLIC_KEY_PATH ??
  path.join(repoRoot, 'docker/app/release-signing.pub');

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error('usage: sign-manifest.mjs <manifest.json>');

const publicKey = readFileSync(publicKeyPath, 'utf8');
if (isPlaceholderPublicKey(publicKey)) {
  console.error('No release signing key is set up yet. Run `node scripts/release/keygen.mjs`,');
  console.error('commit docker/app/release-signing.pub, and add the RELEASE_SIGNING_KEY secret.');
  process.exit(1);
}
const privateKey = process.env.RELEASE_SIGNING_KEY;
if (!privateKey) {
  console.error('RELEASE_SIGNING_KEY is not set.');
  process.exit(1);
}

const manifest = readFileSync(manifestPath);
const signature = signManifest(manifest, privateKey);
if (!verifyManifest(manifest, signature, publicKey)) {
  console.error(`RELEASE_SIGNING_KEY does not match ${path.relative(repoRoot, publicKeyPath)}.`);
  process.exit(1);
}
writeFileSync(`${manifestPath}.sig`, `${signature}\n`);
console.log(`Signed ${manifestPath}`);
