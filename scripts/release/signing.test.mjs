import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  PLACEHOLDER_MARKER,
  isPlaceholderPublicKey,
  signManifest,
  verifyManifest,
} from './signing.mjs';

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

const manifest = Buffer.from('{"version":"1.2.3","runtime":1}\n');

describe('release manifest signing', () => {
  it('verifies a manifest signed with the matching key', () => {
    const { publicPem, privatePem } = keypair();
    const signature = signManifest(manifest, privatePem);

    assert.equal(verifyManifest(manifest, signature, publicPem), true);
    assert.equal(verifyManifest(manifest, `${signature}\n`, publicPem), true);
  });

  it('rejects a tampered manifest', () => {
    const { publicPem, privatePem } = keypair();
    const signature = signManifest(manifest, privatePem);
    const tampered = Buffer.from('{"version":"1.2.4","runtime":1}\n');

    assert.equal(verifyManifest(tampered, signature, publicPem), false);
  });

  it('rejects a signature from a different key', () => {
    const signer = keypair();
    const other = keypair();

    assert.equal(
      verifyManifest(manifest, signManifest(manifest, signer.privatePem), other.publicPem),
      false,
    );
  });

  it('never verifies against the placeholder key', () => {
    const placeholder = `${PLACEHOLDER_MARKER}\n# run scripts/release/keygen.mjs\n`;

    assert.equal(isPlaceholderPublicKey(placeholder), true);
    assert.equal(verifyManifest(manifest, 'AAAA', placeholder), false);
  });
});
