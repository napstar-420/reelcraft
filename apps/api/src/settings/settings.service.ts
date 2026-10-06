import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { BrowserOsSettingsDto } from '@reelcraft/shared';
import { EngineConfig } from '../config/engine-config';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { appSetting } from '../db/schema';
import { SettingsCipher } from './settings-cipher';

/** Setting names. */
export const SETTING = {
  providerKey: (providerId: string) => `providerKey.${providerId}`,
  browserOsUrl: 'browserOs.url',
  /** The Neo address Reelcraft registered with Codex, so it only ever
   * replaces its own entry. */
  codexNeoMcpUrl: 'codex.neoMcpUrl',
  /** This install's package-signing identity (Ed25519, PEM). */
  packageIdentityPrivateKey: 'packageIdentity.privateKey',
  packageIdentityPublicKey: 'packageIdentity.publicKey',
} as const;

/** How long a read of the table is reused. Writes through this service
 * reset it at once. */
const CACHE_TTL_MS = 5_000;

type Row = { value: string; secret: boolean };

export type SecretValue =
  { value: string; unreadable: false } | { value: null; unreadable: boolean };

/**
 * Settings made in the app, stored in Postgres. Secret values (provider
 * keys) are encrypted with `SettingsCipher`; reading one that can't be
 * decrypted reports it as unreadable instead of failing.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly cipher: SettingsCipher;
  private cache?: { expiresAt: number; rows: Promise<Map<string, Row>> } | undefined;
  private readonly listeners: Array<(key: string) => void> = [];

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly config: EngineConfig,
  ) {
    this.cipher = new SettingsCipher(config.settingsEncryptionSecret);
  }

  /** Calls `listener` with the setting's name after each change. */
  onChange(listener: (key: string) => void): void {
    this.listeners.push(listener);
  }

  async getSecret(key: string): Promise<SecretValue> {
    const row = (await this.rows()).get(key);
    if (!row) return { value: null, unreadable: false };
    const value = row.secret ? this.cipher.decrypt(row.value) : row.value;
    if (value === null) {
      this.logger.warn({ key }, 'saved setting cannot be decrypted');
      return { value: null, unreadable: true };
    }
    return { value, unreadable: false };
  }

  async get(key: string): Promise<string | undefined> {
    const row = (await this.rows()).get(key);
    if (!row || row.secret) return undefined;
    return row.value;
  }

  async setSecret(key: string, value: string): Promise<void> {
    await this.write(key, this.cipher.encrypt(value), true);
  }

  async set(key: string, value: string): Promise<void> {
    await this.write(key, value, false);
  }

  async delete(key: string): Promise<void> {
    await this.db.delete(appSetting).where(eq(appSetting.key, key));
    this.changed(key);
  }

  /** BrowserOS Neo's MCP address: saved in Settings, else the environment's,
   * else the default. */
  async browserOs(): Promise<BrowserOsSettingsDto> {
    const saved = await this.get(SETTING.browserOsUrl);
    if (saved) return { url: saved, source: 'saved' };
    const env = this.config.codexBrowserOsUrlFromEnv;
    return { url: this.config.codexBrowserOsUrl, source: env ? 'env' : 'default' };
  }

  async browserOsUrl(): Promise<string> {
    return (await this.browserOs()).url;
  }

  private async write(key: string, value: string, secret: boolean): Promise<void> {
    const updatedAt = new Date().toISOString();
    await this.db
      .insert(appSetting)
      .values({ key, value, secret, updatedAt })
      .onConflictDoUpdate({ target: appSetting.key, set: { value, secret, updatedAt } });
    this.changed(key);
  }

  private changed(key: string): void {
    this.cache = undefined;
    for (const listener of this.listeners) {
      try {
        listener(key);
      } catch (error) {
        this.logger.warn({ err: error, key }, 'settings change listener failed');
      }
    }
  }

  private rows(): Promise<Map<string, Row>> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.rows;
    const rows = this.db
      .select({ key: appSetting.key, value: appSetting.value, secret: appSetting.secret })
      .from(appSetting)
      .then((list) => new Map(list.map((row) => [row.key, row])));
    this.cache = { expiresAt: Date.now() + CACHE_TTL_MS, rows };
    rows.catch(() => {
      if (this.cache?.rows === rows) this.cache = undefined;
    });
    return rows;
  }
}
