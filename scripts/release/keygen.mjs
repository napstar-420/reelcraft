#!/usr/bin/env node
// One-time setup: creates the release signing keypair. Writes the public key
// into the repo and prints the private key for the RELEASE_SIGNING_KEY secret.
// Run it on your own machine; the private key is never written to disk.
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPlaceholderPublicKey } from './signing.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicKeyPath = path.join(repoRoot, 'docker/app/release-signing.pub');
const force = process.argv.includes('--force');

const existing = readFileSync(publicKeyPath, 'utf8');
if (!isPlaceholderPublicKey(existing) && !force) {
  console.error(
    `${publicKeyPath} already holds a real key. Replacing it means installs on older ` +
      'versions can no longer verify new releases. Re-run with --force only if the old ' +
      'private key is lost or leaked.',
  );
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));

console.log(`Public key written to ${path.relative(repoRoot, publicKeyPath)}. Commit it.\n`);
console.log('Add the private key below as the RELEASE_SIGNING_KEY repository secret');
console.log('(GitHub → Settings → Secrets and variables → Actions). Keep a backup in a');
console.log('password manager; it is not saved anywhere else.\n');
console.log(privateKey.export({ type: 'pkcs8', format: 'pem' }));
