import { pgTable, text, timestamptz } from './pg-helpers';

/** Authors whose packages this install has chosen to trust, by the
 * fingerprint of their signing key. Not tied to a channel or blueprint, so
 * nothing cascades into it. */
export const packageTrustedAuthor = pgTable('package_trusted_author', {
  fingerprint: text('fingerprint').primaryKey(), // hex SHA-256 prefix of the public key
  publicKey: text('public_key').notNull(), // SPKI PEM
  trustedAt: timestamptz('trusted_at').notNull().defaultNow(), // when it was trusted
});
