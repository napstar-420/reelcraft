import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import type {
  PackageIdentityBackupDto,
  PackageIdentityDto,
  PackageIdentityStatusDto,
  TrustedAuthorDto,
} from '@reelcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { packageTrustedAuthor } from '../db/schema';
import { SETTING, SettingsService } from '../settings/settings.service';
import {
  fingerprintOf,
  generateKeyPair,
  keyPairFromPrivate,
  signBytes,
  type KeyPairPem,
} from './package-signing';

type Loaded = { kind: 'ready'; pair: KeyPairPem } | { kind: 'unreadable' };

/**
 * This install's signing identity: an Ed25519 key pair made on first use.
 * The private key is stored encrypted in Settings (ADR 0005); the public key
 * is a plain setting. An identity that can no longer be decrypted is never
 * replaced silently: the user picks Regenerate or Restore.
 */
@Injectable()
export class IdentityService {
  private creating?: Promise<KeyPairPem> | undefined;

  constructor(
    private readonly settings: SettingsService,
    @Inject(DRIZZLE) private readonly db: Db,
  ) {}

  async status(): Promise<PackageIdentityStatusDto> {
    const loaded = await this.load();
    return loaded.kind === 'unreadable'
      ? { status: 'unreadable' }
      : { status: 'ready', identity: toDto(loaded.pair) };
  }

  /** Signs `bytes` as this install. Throws if the identity is unreadable. */
  async sign(bytes: Uint8Array): Promise<{ signature: string; author: PackageIdentityDto }> {
    const loaded = await this.load();
    if (loaded.kind === 'unreadable') {
      throw new BadRequestException(
        'The signing identity cannot be read. Regenerate it in Settings.',
      );
    }
    return { signature: signBytes(bytes, loaded.pair.privateKey), author: toDto(loaded.pair) };
  }

  async backup(): Promise<PackageIdentityBackupDto> {
    const loaded = await this.load();
    if (loaded.kind === 'unreadable') {
      throw new BadRequestException(
        'The signing identity cannot be read, so it cannot be backed up.',
      );
    }
    return { format: 'reelcraft.identity', privateKey: loaded.pair.privateKey };
  }

  async restore(backup: PackageIdentityBackupDto): Promise<PackageIdentityDto> {
    const pair = keyPairFromPrivate(backup.privateKey);
    if (!pair) throw new BadRequestException('That is not a Reelcraft identity backup.');
    await this.save(pair);
    return toDto(pair);
  }

  async regenerate(): Promise<PackageIdentityDto> {
    const pair = generateKeyPair();
    await this.save(pair);
    return toDto(pair);
  }

  async listTrusted(): Promise<TrustedAuthorDto[]> {
    const rows = await this.db
      .select()
      .from(packageTrustedAuthor)
      .orderBy(desc(packageTrustedAuthor.trustedAt));
    return rows.map((r) => ({ fingerprint: r.fingerprint, trustedAt: r.trustedAt }));
  }

  async isTrusted(fingerprint: string): Promise<boolean> {
    const [row] = await this.db
      .select({ fingerprint: packageTrustedAuthor.fingerprint })
      .from(packageTrustedAuthor)
      .where(eq(packageTrustedAuthor.fingerprint, fingerprint))
      .limit(1);
    return !!row;
  }

  async trust(publicKey: string): Promise<void> {
    await this.db
      .insert(packageTrustedAuthor)
      .values({ fingerprint: fingerprintOf(publicKey), publicKey })
      .onConflictDoNothing();
  }

  async untrust(fingerprint: string): Promise<void> {
    await this.db
      .delete(packageTrustedAuthor)
      .where(eq(packageTrustedAuthor.fingerprint, fingerprint));
  }

  private async load(): Promise<Loaded> {
    const secret = await this.settings.getSecret(SETTING.packageIdentityPrivateKey);
    if (secret.unreadable) return { kind: 'unreadable' };
    if (secret.value === null) return { kind: 'ready', pair: await this.createOnce() };
    const pair = keyPairFromPrivate(secret.value);
    return pair ? { kind: 'ready', pair } : { kind: 'unreadable' };
  }

  /** Concurrent first calls share one key pair. */
  private createOnce(): Promise<KeyPairPem> {
    this.creating ??= (async () => {
      try {
        const pair = generateKeyPair();
        await this.save(pair);
        return pair;
      } finally {
        this.creating = undefined;
      }
    })();
    return this.creating;
  }

  private async save(pair: KeyPairPem): Promise<void> {
    await this.settings.setSecret(SETTING.packageIdentityPrivateKey, pair.privateKey);
    await this.settings.set(SETTING.packageIdentityPublicKey, pair.publicKey);
  }
}

function toDto(pair: KeyPairPem): PackageIdentityDto {
  return { label: 'local', fingerprint: fingerprintOf(pair.publicKey), publicKey: pair.publicKey };
}
