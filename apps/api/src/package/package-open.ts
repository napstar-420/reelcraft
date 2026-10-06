import { unzipSync } from 'fflate';
import {
  PACKAGE_FORMAT,
  PACKAGE_FORMAT_VERSION,
  PACKAGE_MANIFEST_PATH,
  PACKAGE_PIPELINE_PATH,
  PACKAGE_SIGNATURE_PATH,
  PackageManifest,
  PackagePipeline,
  slotKeyOf,
  type PackageIssueDto,
} from '@reelcraft/shared';
import { collectAssetIds } from '../blueprint/collect-asset-refs';
import { satisfiesMinimum } from '../common/semver';
import { fingerprintOf, sha256Hex, verifyBytes } from './package-signing';

export const PACKAGE_LIMITS = {
  zipBytes: 200 * 1024 * 1024,
  entries: 500,
  fileBytes: 50 * 1024 * 1024,
  totalBytes: 200 * 1024 * 1024,
} as const;

export type PackageIssue = PackageIssueDto;

export interface OpenedPackage {
  manifest: PackageManifest;
  pipeline: PackagePipeline;
  /** Every file by package path, hash-checked against the manifest. */
  files: Map<string, Uint8Array>;
  /** SHA-256 of `manifest.json`: same id and version with another hash means
   * the contents changed without a version bump. */
  contentHash: string;
  /** Whether `manifest.sig` is a valid signature by `manifest.author`. */
  signed: boolean;
}

const block = (code: string, message: string, path?: string): PackageIssue => ({
  severity: 'block',
  code,
  message,
  ...(path ? { path } : {}),
});

/** A package-relative path that stays inside the package. */
function safePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.split('/').some((part) => part === '' || part === '.' || part === '..')
  );
}

const startsWith = (bytes: Uint8Array, ...sig: number[]) => sig.every((b, i) => bytes[i] === b);
const ascii = (bytes: Uint8Array, from: number, text: string) =>
  [...text].every((c, i) => bytes[from + i] === c.charCodeAt(0));

/** The media type of `bytes` judged by its first bytes, or null if unknown. */
export function sniffMime(bytes: Uint8Array): string | null {
  if (startsWith(bytes, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (startsWith(bytes, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (ascii(bytes, 0, 'GIF8')) return 'image/gif';
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return 'image/webp';
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WAVE')) return 'audio/wav';
  if (ascii(bytes, 4, 'ftyp')) return 'video/mp4';
  if (startsWith(bytes, 0x1a, 0x45, 0xdf, 0xa3)) return 'video/webm';
  if (ascii(bytes, 0, 'OggS')) return 'audio/ogg';
  if (ascii(bytes, 0, 'ID3') || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)) {
    return 'audio/mpeg';
  }
  return null;
}

/** Whether the manifest's declared type is one `sniffed` can be. MP4 files
 * are also M4A audio and QuickTime. */
function mimeMatches(declared: string, sniffed: string): boolean {
  if (declared === sniffed) return true;
  if (sniffed === 'video/mp4') return declared === 'audio/mp4' || declared === 'video/quicktime';
  if (sniffed === 'audio/wav') return declared === 'audio/x-wav' || declared === 'audio/wave';
  return false;
}

/**
 * Reads a `.reelpack`: file limits, integrity, signature, format and content
 * checks that need nothing but the bytes. Returns every problem found; when
 * any is a `block`, `opened` is null. Environment checks (capabilities,
 * providers, what is already installed) are `PackageInspectService`'s.
 */
export function openPackage(
  zip: Uint8Array,
  options: { currentVersion: string },
): { issues: PackageIssue[]; opened: OpenedPackage | null } {
  const issues: PackageIssue[] = [];
  const fail = (...found: PackageIssue[]) => ({ issues: [...issues, ...found], opened: null });

  if (zip.byteLength > PACKAGE_LIMITS.zipBytes) {
    return fail(block('too_large', 'This file is too large to be a Reelcraft package.'));
  }

  // Pass 1 reads only the central directory (every file is filtered out), so
  // the limits are checked before anything is decompressed.
  const names: string[] = [];
  let declaredTotal = 0;
  let tooBigFile: string | null = null;
  try {
    unzipSync(zip, {
      filter: (file) => {
        names.push(file.name);
        declaredTotal += file.originalSize;
        if (file.originalSize > PACKAGE_LIMITS.fileBytes) tooBigFile = file.name;
        return false;
      },
    });
  } catch {
    return fail(block('not_a_package', "This isn't a Reelcraft package."));
  }
  if (names.length > PACKAGE_LIMITS.entries) {
    return fail(block('too_many_files', 'This package has too many files.'));
  }
  if (tooBigFile) {
    return fail(block('file_too_large', 'A file in this package is too large.', tooBigFile));
  }
  if (declaredTotal > PACKAGE_LIMITS.totalBytes) {
    return fail(block('too_large', 'This package would take up too much space.'));
  }
  const fileNames = names.filter((name) => !name.endsWith('/'));
  if (new Set(fileNames).size !== fileNames.length) {
    return fail(block('duplicate_path', 'This package lists the same file twice.'));
  }
  const unsafe = fileNames.find((name) => !safePath(name));
  if (unsafe !== undefined) {
    return fail(
      block('unsafe_path', 'This package has a file path it is not allowed to use.', unsafe),
    );
  }

  const entries = unzipSync(zip, { filter: (file) => !file.name.endsWith('/') });
  const manifestBytes = entries[PACKAGE_MANIFEST_PATH];
  if (!manifestBytes) {
    return fail(block('no_manifest', "This isn't a Reelcraft package: it has no manifest."));
  }

  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(Buffer.from(manifestBytes).toString('utf8'));
  } catch {
    return fail(block('invalid_manifest', 'The package manifest is damaged.'));
  }
  const header = rawManifest as { format?: unknown; formatVersion?: unknown } | null;
  if (header?.format !== PACKAGE_FORMAT) {
    return fail(block('not_a_package', "This isn't a Reelcraft package."));
  }
  if (typeof header.formatVersion === 'number' && header.formatVersion > PACKAGE_FORMAT_VERSION) {
    return fail(
      block(
        'newer_format',
        'This package was made by a newer version of Reelcraft. Update Reelcraft to import it.',
      ),
    );
  }
  const parsedManifest = PackageManifest.safeParse(rawManifest);
  if (!parsedManifest.success) {
    return fail(
      ...parsedManifest.error.issues.map((i) =>
        block('invalid_manifest', `Manifest: ${i.message}`, i.path.join('.')),
      ),
    );
  }
  const manifest = parsedManifest.data;

  if (!satisfiesMinimum(options.currentVersion, manifest.minReelcraft)) {
    return fail(
      block(
        'newer_reelcraft_needed',
        `This package needs Reelcraft ${manifest.minReelcraft} or newer. Update Reelcraft to import it.`,
      ),
    );
  }

  // Signature: valid, absent (allowed with a warning) or wrong (blocks).
  let signed = false;
  const signatureBytes = entries[PACKAGE_SIGNATURE_PATH];
  if (!signatureBytes) {
    issues.push({
      severity: 'warn',
      code: 'unsigned',
      message: "This package isn't signed, so there's no way to tell who made it.",
    });
  } else {
    let fingerprintOk = false;
    try {
      fingerprintOk = fingerprintOf(manifest.author.publicKey) === manifest.author.fingerprint;
    } catch {
      fingerprintOk = false;
    }
    signed =
      fingerprintOk &&
      verifyBytes(
        manifestBytes,
        Buffer.from(signatureBytes).toString('utf8'),
        manifest.author.publicKey,
      );
    if (!signed) {
      return fail(
        block('bad_signature', 'This package was modified or damaged after it was signed.'),
      );
    }
  }

  // Files: exactly the ones the manifest lists, with matching hashes.
  const listed = new Map(manifest.files.map((f) => [f.path, f]));
  if (listed.size !== manifest.files.length) {
    return fail(block('duplicate_path', 'The manifest lists the same file twice.'));
  }
  const present = fileNames.filter(
    (n) => n !== PACKAGE_MANIFEST_PATH && n !== PACKAGE_SIGNATURE_PATH,
  );
  for (const name of present) {
    if (!listed.has(name)) {
      issues.push(
        block('unlisted_file', 'This package contains a file its manifest does not list.', name),
      );
    }
  }
  const files = new Map<string, Uint8Array>();
  for (const [path, file] of listed) {
    const bytes = entries[path];
    if (!bytes) {
      issues.push(block('missing_file', 'A file listed in the manifest is missing.', path));
      continue;
    }
    if (bytes.byteLength !== file.bytes || sha256Hex(bytes) !== file.sha256) {
      issues.push(block('hash_mismatch', 'A file was modified or damaged.', path));
      continue;
    }
    if (path.startsWith('media/')) {
      const sniffed = sniffMime(bytes);
      if (!sniffed || !mimeMatches(file.mime, sniffed)) {
        issues.push(block('media_type_mismatch', 'A media file is not what it says it is.', path));
        continue;
      }
    }
    files.set(path, bytes);
  }
  if (!listed.has(PACKAGE_PIPELINE_PATH)) {
    issues.push(block('no_pipeline', 'The package has no pipeline.', PACKAGE_PIPELINE_PATH));
  }
  if (issues.some((i) => i.severity === 'block')) return fail();

  // Pipeline.
  let pipeline: PackagePipeline;
  try {
    const parsed = PackagePipeline.safeParse(
      JSON.parse(Buffer.from(files.get(PACKAGE_PIPELINE_PATH)!).toString('utf8')),
    );
    if (!parsed.success) {
      return fail(
        ...parsed.error.issues.map((i) =>
          block('invalid_pipeline', `Pipeline: ${i.message}`, i.path.join('.')),
        ),
      );
    }
    pipeline = parsed.data;
  } catch {
    return fail(block('invalid_pipeline', 'The pipeline is damaged.', PACKAGE_PIPELINE_PATH));
  }

  // Slots: unique, backed by listed media, and the only local references.
  const slotKeys = new Set<string>();
  for (const slot of manifest.slots) {
    if (slotKeys.has(slot.key)) {
      issues.push(block('duplicate_slot', `Slot "${slot.key}" is declared twice.`));
    }
    slotKeys.add(slot.key);
    const paths =
      slot.bundled === null
        ? []
        : slot.kind === 'asset'
          ? [slot.bundled.path]
          : slot.bundled.references.map((r) => r.path);
    for (const path of paths) {
      if (!files.has(path) || !path.startsWith('media/')) {
        issues.push(
          block('slot_file_missing', `Slot "${slot.key}" points at a missing file.`, path),
        );
      }
    }
    if (slot.kind === 'character' && slot.bundled) {
      const refs = new Set(slot.bundled.references.map((r) => r.path));
      if (slot.bundled.selected.some((p) => !refs.has(p))) {
        issues.push(
          block('slot_file_missing', `Slot "${slot.key}" selects a reference it does not have.`),
        );
      }
    }
  }
  const slotOf = (key: string) => manifest.slots.find((s) => s.key === key);
  for (const id of collectAssetIds(pipeline.graph)) {
    const key = slotKeyOf(id);
    if (key === null) {
      issues.push(
        block('unbound_reference', 'The pipeline refers to an asset from the author’s install.'),
      );
    } else if (slotOf(key)?.kind !== 'asset') {
      issues.push(
        block(
          'unknown_slot',
          `The pipeline uses an asset slot "${key}" the package does not declare.`,
        ),
      );
    }
  }
  for (const role of pipeline.roles) {
    if (!role.characterId) continue;
    const key = slotKeyOf(role.characterId);
    if (key === null) {
      issues.push(
        block('unbound_reference', 'The pipeline refers to a character from the author’s install.'),
      );
    } else if (slotOf(key)?.kind !== 'character') {
      issues.push(
        block(
          'unknown_slot',
          `The pipeline uses a character slot "${key}" the package does not declare.`,
        ),
      );
    }
  }
  if (issues.some((i) => i.severity === 'block')) return fail();

  return {
    issues,
    opened: { manifest, pipeline, files, contentHash: sha256Hex(manifestBytes), signed },
  };
}
