import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';

/** Ed25519 via node:crypto, the same primitives as release signing
 * (`docker/app/rootfs/usr/local/lib/reelcraft/updater/signing.mjs`). */
export interface KeyPairPem {
  privateKey: string; // PKCS8 PEM
  publicKey: string; // SPKI PEM
}

export function generateKeyPair(): KeyPairPem {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

/** The key pair for a private key, or null if it isn't an Ed25519 key. */
export function keyPairFromPrivate(privateKeyPem: string): KeyPairPem | null {
  try {
    const key = createPrivateKey(privateKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') return null;
    return {
      privateKey: key.export({ type: 'pkcs8', format: 'pem' }).toString(),
      publicKey: createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString(),
    };
  } catch {
    return null;
  }
}

/** First 16 bytes of SHA-256 over the public key's DER, as 32 hex chars. */
export function fingerprintOf(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex').slice(0, 32);
}

export function signBytes(bytes: Uint8Array, privateKeyPem: string): string {
  return sign(null, bytes, privateKeyPem).toString('base64');
}

/** False for a bad signature, a wrong key, or anything that isn't a valid
 * Ed25519 public key. Never throws. */
export function verifyBytes(
  bytes: Uint8Array,
  signatureBase64: string,
  publicKeyPem: string,
): boolean {
  try {
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') return false;
    return verify(null, bytes, key, Buffer.from(signatureBase64.trim(), 'base64'));
  } catch {
    return false;
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
