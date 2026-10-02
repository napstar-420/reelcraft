import { describe, expect, it } from 'vitest';
import { SettingsCipher } from './settings-cipher';

const SECRET = 'a-test-secret-that-is-long-enough-123456';

describe('SettingsCipher', () => {
  it('round-trips a value without storing it in clear text', () => {
    const cipher = new SettingsCipher(SECRET);
    const stored = cipher.encrypt('sk-or-v1-abcdef');
    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain('sk-or-v1-abcdef');
    expect(cipher.decrypt(stored)).toBe('sk-or-v1-abcdef');
  });

  it('uses a fresh IV for every encryption', () => {
    const cipher = new SettingsCipher(SECRET);
    expect(cipher.encrypt('same')).not.toBe(cipher.encrypt('same'));
  });

  it('returns null for a value encrypted with another secret', () => {
    const stored = new SettingsCipher(SECRET).encrypt('value');
    expect(new SettingsCipher(`${SECRET}-other`).decrypt(stored)).toBeNull();
  });

  it('returns null for tampered or malformed values', () => {
    const cipher = new SettingsCipher(SECRET);
    const [v, iv, tag, ct] = cipher.encrypt('value').split(':');
    const flipped = Buffer.from(ct!, 'base64');
    flipped[0] = flipped[0]! ^ 1;
    expect(cipher.decrypt([v, iv, tag, flipped.toString('base64')].join(':'))).toBeNull();
    expect(cipher.decrypt('plain text')).toBeNull();
    expect(cipher.decrypt('v2:a:b:c')).toBeNull();
  });
});
