import { z } from 'zod';
import { AssetKind } from './asset.dto';
import { CreateBlueprintVersionDto } from './blueprint.dto';
import { ReferenceImage } from '../character';

/** The `.reelpack` format this build writes, and the newest it can read. */
export const PACKAGE_FORMAT = 'reelcraft.package';
export const PACKAGE_FORMAT_VERSION = 1;

/** Zip entries that are not listed in the manifest's `files`. */
export const PACKAGE_MANIFEST_PATH = 'manifest.json';
export const PACKAGE_SIGNATURE_PATH = 'manifest.sig';
export const PACKAGE_PIPELINE_PATH = 'pipeline.json';

/** Where a local id used to be in the pipeline: `@slot:<key>`. */
export const SLOT_PREFIX = '@slot:';
export const slotRef = (key: string): string => `${SLOT_PREFIX}${key}`;
export const slotKeyOf = (value: string): string | null =>
  value.startsWith(SLOT_PREFIX) ? value.slice(SLOT_PREFIX.length) : null;

/** A package-relative file path: no leading slash, no `..`, no backslash. */
const PackagePath = z
  .string()
  .min(1)
  .refine(
    (p) =>
      !p.startsWith('/') &&
      !p.includes('\\') &&
      !p.split('/').some((part) => part === '..' || part === '.' || part === ''),
    'must be a relative path inside the package',
  );

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const PackageFile = z.object({
  path: PackagePath,
  sha256: Sha256,
  bytes: z.number().int().nonnegative(),
  mime: z.string().min(1),
});
export type PackageFile = z.infer<typeof PackageFile>;

export const BundledCharacter = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  references: z
    .array(
      z.object({
        path: PackagePath,
        view: ReferenceImage.shape.view,
        caption: z.string().optional(),
        order: z.number().int(),
      }),
    )
    .min(1),
  /** Paths of the references the pipeline's role selects, in order. */
  selected: z.array(PackagePath).default([]),
});
export type BundledCharacter = z.infer<typeof BundledCharacter>;

export const BundledAsset = z.object({
  name: z.string().min(1),
  kind: AssetKind,
  path: PackagePath,
});
export type BundledAsset = z.infer<typeof BundledAsset>;

/** A hole in the pipeline that the importer fills: with the bundled media
 * (`bundled`) or with one of their own characters or assets. */
export const PackageSlot = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('character'),
    key: z.string().min(1),
    label: z.string().min(1),
    required: z.boolean(),
    bundled: BundledCharacter.nullable(),
  }),
  z.object({
    kind: z.literal('asset'),
    key: z.string().min(1),
    label: z.string().min(1),
    required: z.boolean(),
    assetKind: AssetKind,
    bundled: BundledAsset.nullable(),
  }),
]);
export type PackageSlot = z.infer<typeof PackageSlot>;

export const PackageAuthor = z.object({
  /** Always "local": an install has an identity, not an account. */
  label: z.literal('local'),
  /** SPKI PEM. */
  publicKey: z.string().min(1),
  fingerprint: z.string().regex(/^[0-9a-f]{32}$/),
});
export type PackageAuthor = z.infer<typeof PackageAuthor>;

/** What `manifest.sig` signs, byte for byte. */
export const PackageManifest = z.object({
  format: z.literal(PACKAGE_FORMAT),
  formatVersion: z.number().int().positive(),
  package: z.object({
    id: z.string().min(1),
    /** The blueprint version this package holds, e.g. "1.2". */
    version: z.string().regex(/^\d+\.\d+$/),
  }),
  author: PackageAuthor,
  basedOn: z.object({ packageId: z.string(), fingerprint: z.string() }).optional(),
  exportedBy: z.string(),
  minReelcraft: z.string(),
  meta: z.object({
    name: z.string().min(1),
    description: z.string().default(''),
    tags: z.array(z.string()).default([]),
  }),
  files: z.array(PackageFile),
  slots: z.array(PackageSlot),
  /** What the author's pipeline needed. Informational: an import works it
   * out again from the pipeline itself. */
  requires: z.object({
    capabilities: z.array(z.string()),
    providers: z.array(z.string()),
  }),
});
export type PackageManifest = z.infer<typeof PackageManifest>;

/** A blueprint version without its budget (the importer sets the run cap),
 * whose local ids are `@slot:` placeholders. */
export const PackagePipeline = CreateBlueprintVersionDto.omit({ budget: true });
export type PackagePipeline = z.infer<typeof PackagePipeline>;

/** This install's signing identity. The private key never leaves the API
 * except through an explicit backup. */
export const PackageIdentityDto = z.object({
  label: z.literal('local'),
  fingerprint: z.string(),
  publicKey: z.string(),
});
export type PackageIdentityDto = z.infer<typeof PackageIdentityDto>;

export const PackageIdentityStatusDto = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ready'), identity: PackageIdentityDto }),
  /** A key is saved but can't be decrypted (the encryption secret changed). */
  z.object({ status: z.literal('unreadable') }),
]);
export type PackageIdentityStatusDto = z.infer<typeof PackageIdentityStatusDto>;

export const PackageIdentityBackupDto = z.object({
  format: z.literal('reelcraft.identity'),
  privateKey: z.string().min(1),
});
export type PackageIdentityBackupDto = z.infer<typeof PackageIdentityBackupDto>;

export const TrustedAuthorDto = z.object({
  fingerprint: z.string(),
  trustedAt: z.string(),
});
export type TrustedAuthorDto = z.infer<typeof TrustedAuthorDto>;
