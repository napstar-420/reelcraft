import { index, jsonb, pgTable, text, timestamptz } from './pg-helpers';
import { blueprint, blueprintVersion } from './blueprint';

/** Where a blueprint (version) came from: the package it was installed from.
 * Rows go with their blueprint (`BlueprintService.delete`, `ChannelService.delete`). */
export const packageImport = pgTable(
  'package_import',
  {
    id: text('id').primaryKey(), // unique import identifier
    blueprintId: text('blueprint_id')
      .notNull()
      .references(() => blueprint.id), // blueprint the package was installed into
    blueprintVersionId: text('blueprint_version_id')
      .notNull()
      .references(() => blueprintVersion.id), // version the install created
    packageId: text('package_id').notNull(), // id the package carries
    packageVersion: text('package_version').notNull(), // e.g. "1.2"
    contentHash: text('content_hash').notNull(), // SHA-256 of the manifest bytes
    authorFingerprint: text('author_fingerprint'), // signer's key fingerprint; null if unsigned
    basedOn: jsonb('based_on'), // { packageId, fingerprint } the package says it was made from
    importedAt: timestamptz('imported_at').notNull().defaultNow(), // when it was installed
  },
  (t) => [index('package_import_package_id_idx').on(t.packageId)],
);
