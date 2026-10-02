import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const SALT = 'reelcraft-settings';
const INFO = 'reelcraft settings v1';

/**
 * AES-256-GCM for secret settings (provider keys). The key is derived from a
 * secret kept outside the database (`/data/secrets.env` in the image), so
 * database dumps and backups never hold a readable key.
 * Stored form: `v1:<iv>:<tag>:<ciphertext>`, each part base64.
 */
export class SettingsCipher {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (!secret) throw new Error('SettingsCipher needs a secret');
    this.key = Buffer.from(hkdfSync('sha256', secret, SALT, INFO, 32));
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), ciphertext]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64')))
      .join(':');
  }

  /** The plain value, or null when it was encrypted with another secret or
   * has been tampered with. */
  decrypt(stored: string): string | null {
    const [version, iv, tag, ciphertext, ...rest] = stored.split(':');
    if (version !== VERSION || !iv || !tag || ciphertext === undefined || rest.length) return null;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return null;
    }
  }
}
