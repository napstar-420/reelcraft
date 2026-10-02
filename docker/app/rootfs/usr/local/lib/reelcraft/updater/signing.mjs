// Release manifest signing. Ed25519 via node:crypto only, so the in-app
// updater can verify releases with the same primitives and no extra tools.
import { createPublicKey, sign, verify } from 'node:crypto';

/** First line of the committed public key until `keygen.mjs` has been run. */
export const PLACEHOLDER_MARKER = '# reelcraft-release-signing-key: placeholder';

export function isPlaceholderPublicKey(publicKeyPem) {
  return publicKeyPem.trimStart().startsWith(PLACEHOLDER_MARKER);
}

/** Returns the base64 signature over the exact manifest bytes. */
export function signManifest(manifestBytes, privateKeyPem) {
  return sign(null, Buffer.from(manifestBytes), privateKeyPem).toString('base64');
}

export function verifyManifest(manifestBytes, signatureBase64, publicKeyPem) {
  if (isPlaceholderPublicKey(publicKeyPem)) return false;
  const key = createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') return false;
  return verify(
    null,
    Buffer.from(manifestBytes),
    key,
    Buffer.from(signatureBase64.trim(), 'base64'),
  );
}
