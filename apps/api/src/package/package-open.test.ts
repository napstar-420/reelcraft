import { zipSync, type Zippable } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  PACKAGE_FORMAT,
  PACKAGE_FORMAT_VERSION,
  slotRef,
  type PackageManifest,
  type PackagePipeline,
} from '@reelcraft/shared';
import { openPackage, sniffMime } from './package-open';
import { fingerprintOf, generateKeyPair, sha256Hex, signBytes } from './package-signing';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('-image')]);
const key = generateKeyPair();
const author = {
  label: 'local' as const,
  publicKey: key.publicKey,
  fingerprint: fingerprintOf(key.publicKey),
};

interface Parts {
  manifest?: Partial<PackageManifest>;
  pipeline?: PackagePipeline;
  media?: Record<string, Buffer>;
  sign?: boolean;
  /** Extra zip entries added after the manifest is built. */
  extra?: Zippable;
  tamper?: (zip: Record<string, Uint8Array | [Uint8Array, object]>) => void;
}

/** Builds a package the way the exporter does, with hooks to break it. */
function build(parts: Parts = {}): Uint8Array {
  const pipeline: PackagePipeline = parts.pipeline ?? {
    graph: [],
    inputs: [],
    roles: [],
    defaults: {},
  };
  const pipelineBytes = Buffer.from(JSON.stringify(pipeline));
  const media = parts.media ?? { 'media/a.png': PNG };
  const manifest: PackageManifest = {
    format: PACKAGE_FORMAT,
    formatVersion: PACKAGE_FORMAT_VERSION,
    package: { id: 'pkg', version: '1.0' },
    author,
    exportedBy: '0.4.1',
    minReelcraft: '0.4.1',
    meta: { name: 'Pack', description: '', tags: [] },
    files: [
      {
        path: 'pipeline.json',
        sha256: sha256Hex(pipelineBytes),
        bytes: pipelineBytes.length,
        mime: 'application/json',
      },
      ...Object.entries(media).map(([path, b]) => ({
        path,
        sha256: sha256Hex(b),
        bytes: b.length,
        mime: 'image/png',
      })),
    ],
    slots: [],
    requires: { capabilities: [], providers: [] },
    ...parts.manifest,
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const zip: Zippable = {
    'manifest.json': manifestBytes,
    'pipeline.json': pipelineBytes,
    ...media,
    ...parts.extra,
  };
  if (parts.sign !== false)
    zip['manifest.sig'] = Buffer.from(signBytes(manifestBytes, key.privateKey));
  parts.tamper?.(zip as never);
  return zipSync(zip);
}

const open = (zip: Uint8Array, currentVersion = '0.4.1') => openPackage(zip, { currentVersion });
const codes = (zip: Uint8Array, v?: string) => open(zip, v).issues.map((i) => i.code);

describe('openPackage', () => {
  it('opens a valid signed package', () => {
    const { opened, issues } = open(build());
    expect(issues).toEqual([]);
    expect(opened?.signed).toBe(true);
    expect(opened?.manifest.package.id).toBe('pkg');
    expect(opened?.files.has('media/a.png')).toBe(true);
    expect(opened?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('warns about an unsigned package but still opens it', () => {
    const { opened, issues } = open(build({ sign: false }));
    expect(opened?.signed).toBe(false);
    expect(issues.map((i) => [i.severity, i.code])).toEqual([['warn', 'unsigned']]);
  });

  it('blocks a file that is not a zip, or has no manifest', () => {
    expect(codes(Buffer.from('plain text, not a zip'))).toEqual(['not_a_package']);
    expect(codes(zipSync({ 'other.txt': Buffer.from('x') }))).toEqual(['no_manifest']);
  });

  it('blocks a path that escapes the package', () => {
    expect(codes(build({ extra: { '../evil.txt': Buffer.from('x') } }))).toEqual(['unsafe_path']);
    expect(codes(build({ extra: { '/abs.txt': Buffer.from('x') } }))).toEqual(['unsafe_path']);
  });

  it('blocks a file the manifest does not list, and a listed file that is missing', () => {
    expect(codes(build({ extra: { 'media/extra.png': PNG } }))).toContain('unlisted_file');
    expect(codes(build({ tamper: (z) => delete z['media/a.png'] }))).toContain('missing_file');
  });

  it('blocks a file whose bytes changed, and a changed manifest', () => {
    expect(
      codes(build({ tamper: (z) => (z['media/a.png'] = Buffer.concat([PNG, Buffer.from('x')])) })),
    ).toContain('hash_mismatch');

    const zip = build({
      tamper: (z) => {
        const m = JSON.parse(Buffer.from(z['manifest.json'] as Buffer).toString());
        m.meta.name = 'Hijacked';
        z['manifest.json'] = Buffer.from(JSON.stringify(m));
      },
    });
    expect(codes(zip)).toEqual(['bad_signature']);
  });

  it('blocks a signature made by a different key than the manifest names', () => {
    const other = generateKeyPair();
    const zip = build({
      tamper: (z) => {
        z['manifest.sig'] = Buffer.from(signBytes(z['manifest.json'] as Buffer, other.privateKey));
      },
    });
    expect(codes(zip)).toEqual(['bad_signature']);
  });

  it('blocks media that is not what its type says', () => {
    const fake = Buffer.from('this is not a png');
    expect(codes(build({ media: { 'media/a.png': fake } }))).toEqual(['media_type_mismatch']);
  });

  it('blocks a package from a newer format or one needing a newer Reelcraft', () => {
    expect(codes(build({ manifest: { formatVersion: 99 } }))).toEqual(['newer_format']);
    expect(codes(build({ manifest: { minReelcraft: '9.0.0' } }))).toEqual([
      'newer_reelcraft_needed',
    ]);
    expect(open(build({ manifest: { minReelcraft: '9.0.0' } }), 'dev').opened).not.toBeNull();
  });

  it('blocks an invalid manifest and an invalid pipeline, naming the field', () => {
    const noName = build({ manifest: { meta: { name: '', description: '', tags: [] } } });
    expect(open(noName).issues[0]).toMatchObject({ code: 'invalid_manifest', path: 'meta.name' });
    const badPipeline = build({ pipeline: { graph: 'nope' } as unknown as PackagePipeline });
    expect(codes(badPipeline)).toContain('invalid_pipeline');
  });

  it('blocks a pipeline that uses an undeclared slot or a leaked local id', () => {
    const stage = (assetId: string) => ({
      key: 's',
      label: 'S',
      capability: 'text.generate',
      config: {},
      slots: { a: { from: 'asset' as const, assetId } },
      context: {},
      output: { kind: 'text' as const },
      checks: [],
    });
    const pipe = (assetId: string): PackagePipeline => ({
      graph: [stage(assetId)],
      inputs: [],
      roles: [],
      defaults: {},
    });
    expect(codes(build({ pipeline: pipe(slotRef('logo')) }))).toEqual(['unknown_slot']);
    expect(codes(build({ pipeline: pipe('01HLOCALASSETID') }))).toEqual(['unbound_reference']);

    const declared = build({
      pipeline: pipe(slotRef('logo')),
      manifest: {
        slots: [
          {
            kind: 'asset',
            key: 'logo',
            label: 'Logo',
            required: true,
            assetKind: 'media.image',
            bundled: null,
          },
        ],
      },
    });
    expect(open(declared).issues).toEqual([]);
  });

  it('blocks a slot that points at a file the package does not have', () => {
    const zip = build({
      manifest: {
        slots: [
          {
            kind: 'asset',
            key: 'logo',
            label: 'Logo',
            required: true,
            assetKind: 'media.image',
            bundled: { name: 'Logo', kind: 'media.image', path: 'media/missing.png' },
          },
        ],
      },
    });
    expect(codes(zip)).toEqual(['slot_file_missing']);
  });
});

describe('openPackage zip bombs', () => {
  it('blocks a file that would expand past the limit without decompressing it', () => {
    const big = Buffer.concat([PNG, Buffer.alloc(60 * 1024 * 1024)]);
    expect(codes(build({ media: { 'media/a.png': big } }))).toEqual(['file_too_large']);
  });

  it('cannot be made to expand past a size the archive lies about', () => {
    const body = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]);
    const zip = build({ media: { 'media/a.png': body } });
    // Shrink the uncompressed size in the local and central headers.
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (let i = 0; i < zip.length - 30; i++) {
      const sig = view.getUint32(i, true);
      if (sig === 0x04034b50 && view.getUint32(i + 22, true) === body.length) {
        view.setUint32(i + 22, 100, true);
      }
      if (sig === 0x02014b50 && view.getUint32(i + 24, true) === body.length) {
        view.setUint32(i + 24, 100, true);
      }
    }
    expect(open(zip).opened).toBeNull();
    expect(codes(zip)).toContain('hash_mismatch');
  });
});

describe('sniffMime', () => {
  it('recognises common media by their first bytes', () => {
    expect(sniffMime(PNG)).toBe('image/png');
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from('RIFF....WEBPVP8 '))).toBe('image/webp');
    expect(sniffMime(Buffer.from('....ftypisom'))).toBe('video/mp4');
    expect(sniffMime(Buffer.from('hello world'))).toBeNull();
  });
});
