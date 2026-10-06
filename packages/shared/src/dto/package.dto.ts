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
    /** How many reference images the role uses. A role must select at least
     * one, so an importer's own character gets this many of its references. */
    referenceCount: z.number().int().min(1).optional(),
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

/** One local thing a blueprint version points at: an asset, or the
 * character a role selects. The exporter decides, for each, whether its
 * media travels in the package or the importer fills the slot. */
export const PackageReferenceDto = z.object({
  id: z.string(),
  kind: z.enum(['asset', 'character']),
  name: z.string(),
  assetKind: AssetKind.optional(),
  /** Bytes of the media that would be bundled. */
  bytes: z.number(),
  /** Deleted, or its file is gone: can only become an empty slot. */
  missing: z.boolean(),
  /** Too big to bundle: can only become a slot. */
  tooLarge: z.boolean(),
});
export type PackageReferenceDto = z.infer<typeof PackageReferenceDto>;

/** Something in the pipeline that looks personal or secret. The value itself
 * is never sent back, only where it is. */
export const PackagePrivacyFlagDto = z.object({
  path: z.string(),
  kind: z.enum(['email', 'secret']),
});
export type PackagePrivacyFlagDto = z.infer<typeof PackagePrivacyFlagDto>;

export const PackageExportPreviewDto = z.object({
  name: z.string(),
  version: z.string(),
  references: z.array(PackageReferenceDto),
  privacy: z.array(PackagePrivacyFlagDto),
});
export type PackageExportPreviewDto = z.infer<typeof PackageExportPreviewDto>;

export const ExportPackageDto = z.object({
  /** Per reference id: ship its media (`bundle`, the default) or leave a
   * `slot` for the importer to fill. */
  choices: z.record(z.string(), z.enum(['bundle', 'slot'])).default({}),
});
export type ExportPackageDto = z.infer<typeof ExportPackageDto>;

/** What stops or shapes an import. `block` can't be worked around, `fix`
 * needs the importer to choose something, `warn` is shown and allowed. */
export const PackageIssueDto = z.object({
  severity: z.enum(['block', 'fix', 'warn']),
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
});
export type PackageIssueDto = z.infer<typeof PackageIssueDto>;

export const PackageSignerDto = z.object({
  /** Null when the package is unsigned. */
  fingerprint: z.string().nullable(),
  signed: z.boolean(),
  /** Signed by this install itself, or by an author it was told to trust. */
  trusted: z.boolean(),
  /** Signed by this install's own identity. */
  own: z.boolean(),
});
export type PackageSignerDto = z.infer<typeof PackageSignerDto>;

/** The blueprint in the target channel that already came from this package. */
export const PackageInstalledDto = z.object({
  blueprintId: z.string(),
  blueprintName: z.string(),
  /** The package version last installed, e.g. "1.2". */
  version: z.string(),
  relation: z.enum(['same', 'newer', 'older', 'modified', 'other-signer']),
  /** Whether the package can be added as a new version of that blueprint. */
  canUpdate: z.boolean(),
  /** The blueprint has unsaved canvas edits. */
  hasWorkingDraft: z.boolean(),
});
export type PackageInstalledDto = z.infer<typeof PackageInstalledDto>;

export const PackageInspectReportDto = z.object({
  /** Null when the file could not be read far enough to know. */
  summary: z
    .object({
      name: z.string(),
      description: z.string(),
      tags: z.array(z.string()),
      packageId: z.string(),
      version: z.string(),
      exportedBy: z.string(),
    })
    .nullable(),
  signer: PackageSignerDto,
  slots: z.array(PackageSlot),
  /** Worked out from the pipeline, not taken from the manifest. */
  requires: z.object({ capabilities: z.array(z.string()), providers: z.array(z.string()) }),
  issues: z.array(PackageIssueDto),
  installed: PackageInstalledDto.nullable(),
  /** The package's name, or the first "Name (2)" not taken in the channel. */
  suggestedName: z.string().nullable(),
});
export type PackageInspectReportDto = z.infer<typeof PackageInspectReportDto>;

export const PackageUploadDto = z.object({ uploadUrl: z.string(), objectKey: z.string() });
export type PackageUploadDto = z.infer<typeof PackageUploadDto>;

export const InspectPackageDto = z.object({
  objectKey: z.string().min(1),
  channelId: z.string().min(1),
});
export type InspectPackageDto = z.infer<typeof InspectPackageDto>;

export const CancelPackageUploadDto = z.object({ objectKey: z.string().min(1) });
export type CancelPackageUploadDto = z.infer<typeof CancelPackageUploadDto>;

export const InstallPackageDto = z.object({
  objectKey: z.string().min(1),
  channelId: z.string().min(1),
  /** `new` makes a blueprint; `update` adds a version to `targetBlueprintId`. */
  mode: z.enum(['new', 'update']),
  targetBlueprintId: z.string().optional(),
  name: z.string().trim().min(1),
  /** The importer's own spending limit. A package never sets it. */
  runCapUsd: z.number().positive(),
  /** Per slot: `bundled` uses the media in the package, `existing` one of the
   * importer's own characters or assets. A slot with neither bundled media
   * nor a binding stays empty, which only an optional slot may do. */
  bindings: z
    .record(z.string(), z.union([z.literal('bundled'), z.object({ existing: z.string() })]))
    .default({}),
  trustAuthor: z.boolean().default(false),
});
export type InstallPackageDto = z.infer<typeof InstallPackageDto>;

export const InstallPackageResultDto = z.object({
  blueprintId: z.string(),
  blueprintVersionId: z.string(),
  /** Whether the new version passed validation (a missing provider key or
   * model, for one, leaves it not runnable until fixed). */
  runnable: z.boolean(),
});
export type InstallPackageResultDto = z.infer<typeof InstallPackageResultDto>;
