import { extname } from 'node:path';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { zipSync, type Zippable } from 'fflate';
import {
  PACKAGE_FORMAT,
  PACKAGE_FORMAT_VERSION,
  PACKAGE_MANIFEST_PATH,
  PACKAGE_PIPELINE_PATH,
  PACKAGE_SIGNATURE_PATH,
  slotRef,
  type ExportPackageDto,
  type PackageFile,
  type PackageManifest,
  type PackagePipeline,
  type PackageSlot,
  type ReferenceImage,
} from '@reelcraft/shared';
import type { PackageExportPreviewDto, PackageReferenceDto } from '@reelcraft/shared';
import { asset, blob, blueprint, blueprintVersion, character } from '../db/schema';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { collectAssetIds, mapGraphRefs } from '../blueprint/collect-asset-refs';
import { ulid } from '../common/ulid';
import { isReleaseVersion } from '../common/semver';
import { EngineConfig } from '../config/engine-config';
import { STORAGE_ADAPTER, type StorageAdapter } from '../storage/storage.adapter';
import { IdentityService } from './identity.service';
import { findPrivacyFlags } from './package-privacy';
import { sha256Hex } from './package-signing';

/** Bigger files can't be bundled: the package is built in memory.
 * ponytail: in-memory zip, so a per-file and total cap; stream to disk if packages get large. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

interface PlannedFile {
  blobId: string;
  objectKey: string;
  mime: string;
  bytes: number;
  view?: ReferenceImage['view'];
  caption?: string | undefined;
  order?: number;
}

interface PlannedRef {
  id: string;
  kind: 'asset' | 'character';
  name: string;
  assetKind?: PackageReferenceDto['assetKind'];
  description?: string;
  slotKey: string;
  required: boolean;
  missing: boolean;
  files: PlannedFile[];
}

interface Plan {
  version: typeof blueprintVersion.$inferSelect;
  bp: typeof blueprint.$inferSelect;
  refs: PlannedRef[];
  /** `role.referenceBlobIds` of the role's character, when it picked a subset. */
  roleSelectedBlobIds: string[] | undefined;
}

/** Turns one saved blueprint version into a signed `.reelpack`. */
@Injectable()
export class PackageExportService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly identity: IdentityService,
    private readonly config: EngineConfig,
  ) {}

  async preview(versionId: string): Promise<PackageExportPreviewDto> {
    const plan = await this.plan(versionId);
    const pipeline = this.pipelineOf(plan);
    return {
      name: plan.bp.name,
      version: versionLabel(plan.version),
      references: plan.refs.map((ref) => {
        const bytes = ref.files.reduce((sum, f) => sum + f.bytes, 0);
        return {
          id: ref.id,
          kind: ref.kind,
          name: ref.name,
          ...(ref.assetKind ? { assetKind: ref.assetKind } : {}),
          bytes,
          missing: ref.missing,
          tooLarge: ref.files.some((f) => f.bytes > MAX_FILE_BYTES),
        };
      }),
      privacy: findPrivacyFlags(pipeline),
    };
  }

  async build(
    versionId: string,
    dto: ExportPackageDto,
  ): Promise<{ filename: string; bytes: Uint8Array }> {
    const plan = await this.plan(versionId);
    const media = new Map<string, { bytes: Uint8Array; file: PackageFile }>();
    const slots: PackageSlot[] = [];
    let total = 0;

    const bundle = async (file: PlannedFile): Promise<string> => {
      const content = await this.read(file);
      const sha256 = sha256Hex(content);
      const path = `media/${sha256}${extname(file.objectKey).toLowerCase()}`;
      if (!media.has(path)) {
        total += content.byteLength;
        if (total > MAX_TOTAL_BYTES) {
          throw new BadRequestException('The bundled media is too large. Leave some as slots.');
        }
        media.set(path, {
          bytes: content,
          file: { path, sha256, bytes: content.byteLength, mime: file.mime },
        });
      }
      return path;
    };

    for (const ref of plan.refs) {
      const wantsBundle = (dto.choices[ref.id] ?? 'bundle') === 'bundle';
      const canBundle =
        !ref.missing && ref.files.length > 0 && ref.files.every((f) => f.bytes <= MAX_FILE_BYTES);
      const paths = wantsBundle && canBundle ? await Promise.all(ref.files.map(bundle)) : null;

      if (ref.kind === 'asset') {
        slots.push({
          kind: 'asset',
          key: ref.slotKey,
          label: ref.name,
          required: true,
          assetKind: ref.assetKind!,
          bundled: paths ? { name: ref.name, kind: ref.assetKind!, path: paths[0]! } : null,
        });
      } else {
        const chosen = plan.roleSelectedBlobIds;
        slots.push({
          kind: 'character',
          key: ref.slotKey,
          label: ref.name,
          required: ref.required,
          bundled: paths
            ? {
                name: ref.name,
                description: ref.description ?? '',
                references: ref.files.map((f, i) => ({
                  path: paths[i]!,
                  view: f.view!,
                  ...(f.caption ? { caption: f.caption } : {}),
                  order: f.order ?? i,
                })),
                selected: chosen
                  ? ref.files.flatMap((f, i) => (chosen.includes(f.blobId) ? [paths[i]!] : []))
                  : [],
              }
            : null,
        });
      }
    }

    const pipeline = this.pipelineOf(plan);
    const pipelineBytes = Buffer.from(JSON.stringify(pipeline));
    const status = await this.identity.status();
    if (status.status !== 'ready') {
      throw new BadRequestException(
        'The signing identity cannot be read. Restore or create one in Settings.',
      );
    }

    const packageId = plan.bp.packageId ?? ulid();
    if (!plan.bp.packageId) {
      await this.db.update(blueprint).set({ packageId }).where(eq(blueprint.id, plan.bp.id));
    }

    const manifest: PackageManifest = {
      format: PACKAGE_FORMAT,
      formatVersion: PACKAGE_FORMAT_VERSION,
      package: { id: packageId, version: versionLabel(plan.version) },
      author: status.identity,
      ...(plan.bp.packageBasedOn
        ? { basedOn: plan.bp.packageBasedOn as { packageId: string; fingerprint: string } }
        : {}),
      exportedBy: this.config.version,
      minReelcraft: isReleaseVersion(this.config.version) ? this.config.version : '0.0.0',
      meta: {
        name: plan.bp.name,
        description: plan.bp.description ?? '',
        tags: plan.bp.tags,
      },
      files: [
        {
          path: PACKAGE_PIPELINE_PATH,
          sha256: sha256Hex(pipelineBytes),
          bytes: pipelineBytes.byteLength,
          mime: 'application/json',
        },
        ...[...media.values()].map((m) => m.file),
      ],
      slots,
      requires: requiresOf(
        plan.version.graph as PackagePipeline['graph'],
        plan.version.defaults as PackagePipeline['defaults'],
      ),
    };

    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    const { signature, author } = await this.identity.sign(manifestBytes);
    if (author.fingerprint !== manifest.author.fingerprint) {
      throw new BadRequestException('The signing identity changed during export. Try again.');
    }

    const zip: Zippable = {
      [PACKAGE_MANIFEST_PATH]: manifestBytes,
      [PACKAGE_SIGNATURE_PATH]: Buffer.from(signature),
      [PACKAGE_PIPELINE_PATH]: pipelineBytes,
    };
    // Media is already compressed, so it is stored as is.
    for (const [path, m] of media) zip[path] = [m.bytes, { level: 0 }];

    return {
      filename: `${slug(plan.bp.name)}-${versionLabel(plan.version)}.reelpack`,
      bytes: zipSync(zip),
    };
  }

  /** The pipeline with every local id replaced by its `@slot:` placeholder. */
  private pipelineOf(plan: Plan): PackagePipeline {
    const assetSlot = new Map(
      plan.refs.filter((r) => r.kind === 'asset').map((r) => [r.id, r.slotKey]),
    );
    const characterSlot = plan.refs.find((r) => r.kind === 'character')?.slotKey;
    const graph = mapGraphRefs(plan.version.graph as PackagePipeline['graph'], (ref) =>
      ref.from === 'asset' && assetSlot.has(ref.assetId)
        ? { from: 'asset', assetId: slotRef(assetSlot.get(ref.assetId)!) }
        : ref,
    );
    const roles = (plan.version.roles as PackagePipeline['roles']).map((role) => ({
      key: role.key,
      label: role.label,
      required: role.required,
      ...(role.characterId && characterSlot ? { characterId: slotRef(characterSlot) } : {}),
    }));
    return {
      graph,
      inputs: plan.version.inputs as PackagePipeline['inputs'],
      roles,
      defaults: plan.version.defaults as PackagePipeline['defaults'],
    };
  }

  private async plan(versionId: string): Promise<Plan> {
    const [version] = await this.db
      .select()
      .from(blueprintVersion)
      .where(eq(blueprintVersion.id, versionId))
      .limit(1);
    if (!version) throw new NotFoundException(`Blueprint version ${versionId} not found`);
    if (version.draft) {
      throw new BadRequestException(
        'Save the blueprint first. Only saved versions can be exported.',
      );
    }
    if (!version.runnable) {
      throw new BadRequestException('Fix the blueprint’s problems before exporting it.');
    }
    const [bp] = await this.db
      .select()
      .from(blueprint)
      .where(eq(blueprint.id, version.blueprintId))
      .limit(1);
    if (!bp) throw new NotFoundException(`Blueprint ${version.blueprintId} not found`);

    const refs: PlannedRef[] = [];

    const assetIds = collectAssetIds(version.graph as PackagePipeline['graph']);
    if (assetIds.length > 0) {
      const rows = await this.db
        .select({ asset, blob })
        .from(asset)
        .innerJoin(blob, eq(blob.id, asset.blobId))
        .where(inArray(asset.id, assetIds));
      const byId = new Map(rows.map((r) => [r.asset.id, r]));
      assetIds.forEach((id, i) => {
        const row = byId.get(id);
        const live = !!row && !row.asset.deletedAt && !row.blob.deletedAt;
        refs.push({
          id,
          kind: 'asset',
          name: row?.asset.name ?? `Asset ${i + 1}`,
          assetKind: row?.asset.kind ?? 'media.image',
          slotKey: `asset-${i + 1}`,
          required: true,
          missing: !live,
          files: live ? [plannedFile(row.blob)] : [],
        });
      });
    }

    const role = (version.roles as PackagePipeline['roles'])[0];
    let roleSelectedBlobIds: string[] | undefined;
    if (role?.characterId) {
      const [row] = await this.db
        .select()
        .from(character)
        .where(eq(character.id, role.characterId))
        .limit(1);
      const live = !!row && !row.deletedAt;
      const refsOfCharacter = live ? (row.referenceSet as ReferenceImage[]) : [];
      roleSelectedBlobIds = role.referenceBlobIds;
      const wanted = roleSelectedBlobIds
        ? refsOfCharacter.filter((r) => roleSelectedBlobIds!.includes(r.blobId))
        : refsOfCharacter;
      const blobs = wanted.length
        ? await this.db
            .select()
            .from(blob)
            .where(
              inArray(
                blob.id,
                wanted.map((r) => r.blobId),
              ),
            )
        : [];
      const blobById = new Map(blobs.map((b) => [b.id, b]));
      const files = wanted.flatMap((r) => {
        const b = blobById.get(r.blobId);
        return b && !b.deletedAt
          ? [{ ...plannedFile(b), view: r.view, caption: r.caption, order: r.order }]
          : [];
      });
      refs.push({
        id: role.characterId,
        kind: 'character',
        name: row?.name ?? role.label,
        description: row?.description ?? '',
        slotKey: `character-${role.key}`,
        required: role.required,
        missing: !live || files.length === 0,
        files,
      });
    }

    return { version, bp, refs, roleSelectedBlobIds };
  }

  private async read(file: PlannedFile): Promise<Uint8Array> {
    const chunks: Buffer[] = [];
    for await (const chunk of await this.storage.getStream(file.objectKey)) {
      chunks.push(Buffer.from(chunk as Buffer));
    }
    return Buffer.concat(chunks);
  }
}

function plannedFile(row: typeof blob.$inferSelect): PlannedFile {
  return { blobId: row.id, objectKey: row.objectKey, mime: row.mime, bytes: row.bytes };
}

function versionLabel(v: { major: number; minor: number }): string {
  return `${v.major}.${v.minor}`;
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'blueprint'
  );
}

/** Capabilities and providers the pipeline uses, for the manifest. */
function requiresOf(
  graph: PackagePipeline['graph'],
  defaults: PackagePipeline['defaults'],
): PackageManifest['requires'] {
  const capabilities = new Set<string>();
  const providers = new Set<string>();
  for (const stage of graph) {
    capabilities.add(stage.capability);
    if (stage.model?.provider) providers.add(stage.model.provider);
    if (stage.qc?.model.provider) providers.add(stage.qc.model.provider);
  }
  if (defaults.model?.provider) providers.add(defaults.model.provider);
  return { capabilities: [...capabilities].sort(), providers: [...providers].sort() };
}
