import { describe, expect, it } from 'vitest';
import {
  fingerprintOf,
  generateKeyPair,
  keyPairFromPrivate,
  sha256Hex,
  signBytes,
  verifyBytes,
} from './package-signing';

const bytes = Buffer.from('{"manifest":true}');

describe('package signing', () => {
  it('verifies a signature made with the matching key', () => {
    const { privateKey, publicKey } = generateKeyPair();
    expect(verifyBytes(bytes, signBytes(bytes, privateKey), publicKey)).toBe(true);
  });

  it('rejects changed bytes', () => {
    const { privateKey, publicKey } = generateKeyPair();
    const signature = signBytes(bytes, privateKey);
    expect(verifyBytes(Buffer.from('{"manifest":false}'), signature, publicKey)).toBe(false);
  });

  it('rejects another identity’s key and garbage input without throwing', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const signature = signBytes(bytes, a.privateKey);
    expect(verifyBytes(bytes, signature, b.publicKey)).toBe(false);
    expect(verifyBytes(bytes, 'not base64!!', a.publicKey)).toBe(false);
    expect(verifyBytes(bytes, signature, 'not a pem')).toBe(false);
  });

  it('derives a stable 32-hex fingerprint from the public key', () => {
    const { privateKey, publicKey } = generateKeyPair();
    expect(fingerprintOf(publicKey)).toMatch(/^[0-9a-f]{32}$/);
    expect(fingerprintOf(publicKey)).toBe(fingerprintOf(keyPairFromPrivate(privateKey)!.publicKey));
    expect(fingerprintOf(generateKeyPair().publicKey)).not.toBe(fingerprintOf(publicKey));
  });

  it('rebuilds a key pair from a private key and refuses other key types', () => {
    const pair = generateKeyPair();
    expect(keyPairFromPrivate(pair.privateKey)).toEqual(pair);
    expect(keyPairFromPrivate('garbage')).toBeNull();
  });

  it('hashes with SHA-256', () => {
    expect(sha256Hex(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
