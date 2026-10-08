import { extname } from 'node:path';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  slotKeyOf,
  type InstallPackageDto,
  type InstallPackageResultDto,
  type PackageSlot,
  type ReferenceImage,
} from '@reelcraft/shared';
import { queueStorageOrphans } from '../artifact/storage-orphans';
import { BlueprintService } from '../blueprint/blueprint.service';
import { mapGraphRefs } from '../blueprint/collect-asset-refs';
import { ulid } from '../common/ulid';
import { EngineConfig } from '../config/engine-config';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { asset, blob, blueprint, channel, character, packageImport } from '../db/schema';
import { objectKey } from '../storage/object-key';
import { STORAGE_ADAPTER, type StorageAdapter } from '../storage/storage.adapter';
import { IdentityService } from './identity.service';
import { PackageInspectService } from './package-inspect.service';
import { PackageUploadService } from './package-upload.service';

/** What a slot becomes in the importer's channel. */
type Resolved = { use: 'existing'; id: string } | { use: 'bundled'; id: string } | { use: 'empty' };

interface BlobPlan {
  id: string;
  key: string;
  mime: string;
  bytes: Uint8Array;
  sha256: string;
}

/** Installs an inspected package: media into storage, then characters,
 * assets, blueprint, version and provenance in one transaction. */
@Injectable()
export class PackageInstallService {
  private readonly logger = new Logger(PackageInstallService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly config: EngineConfig,
    private readonly inspector: PackageInspectService,
    private readonly uploads: PackageUploadService,
    private readonly identity: IdentityService,
    private readonly blueprints: BlueprintService,
  ) {}

  async install(ownerId: string, dto: InstallPackageDto): Promise<InstallPackageResultDto> {
    const result = await this.run(ownerId, dto);
    // Installed: the upload is done with. A failed install keeps it, so the
    // user can fix what was wrong and try again; closing the dialog queues it.
    await this.uploads.discard(ownerId, dto.objectKey).catch(() => undefined);
    return result;
  }

  private async run(ownerId: string, dto: InstallPackageDto): Promise<InstallPackageResultDto> {
    // Everything is checked again here: the earlier inspection is only advice.
    const inspected = await this.inspector.inspect(ownerId, dto.objectKey, dto.channelId);
    const { opened, report, installed } = inspected;
    const blocks = report.issues.filter((i) => i.severity === 'block');
    if (!opened || blocks.length > 0) {
      throw new BadRequestException({
        message: 'This package cannot be installed.',
        issues: blocks,
      });
    }
    const { manifest, pipeline } = opened;

    const [channelRow] = await this.db
      .select({ id: channel.id })
      .from(channel)
      .where(eq(channel.id, dto.channelId))
      .limit(1);
    if (!channelRow) throw new NotFoundException(`Channel ${dto.channelId} not found`);

    let bump: 'major' | 'minor' = 'minor';
    if (dto.mode === 'update') {
      if (!report.installed?.canUpdate || report.installed.blueprintId !== dto.targetBlueprintId) {
        throw new BadRequestException(
          'This package cannot be added as a new version of that blueprint. Install it as a separate copy.',
        );
      }
      bump =
        Number(manifest.package.version.split('.')[0]) > Number(installed!.version.split('.')[0])
          ? 'major'
          : 'minor';
    }

    // Decide what each slot becomes.
    const { resolved, characterRefs } = await this.resolveSlots(manifest.slots, dto);
    const [takenAssets, takenCharacters] = await Promise.all([
      this.db
        .select({ name: asset.name })
        .from(asset)
        .where(and(eq(asset.channelId, dto.channelId), isNull(asset.deletedAt))),
      this.db
        .select({ name: character.name })
        .from(character)
        .where(
          and(
            eq(character.channelId, dto.channelId),
            eq(character.scope, 'channel'),
            isNull(character.deletedAt),
          ),
        ),
    ]);
    const assetNames = new Set(takenAssets.map((r) => r.name));
    const characterNames = new Set(takenCharacters.map((r) => r.name));

    // Plan the rows and objects to create for the bundled slots.
    const written: string[] = [];
    const newCharacters: Array<{
      id: string;
      name: string;
      description: string;
      referenceSet: ReferenceImage[];
      blobs: Array<BlobPlan & { characterId: string }>;
    }> = [];
    const newAssets: Array<{
      id: string;
      name: string;
      kind: Extract<PackageSlot, { kind: 'asset' }>['assetKind'];
      blob: BlobPlan;
    }> = [];
    /** Package path of a bundled reference → the blob made for it. */
    const blobForPath = new Map<string, string>();

    const fileOf = (path: string) => {
      const meta = manifest.files.find((f) => f.path === path)!;
      return { bytes: opened.files.get(path)!, mime: meta.mime, sha256: meta.sha256 };
    };

    for (const slot of manifest.slots) {
      const r = resolved.get(slot.key)!;
      if (r.use !== 'bundled' || !slot.bundled) continue;
      if (slot.kind === 'character') {
        const bundled = slot.bundled;
        const characterId = r.id;
        const sorted = [...bundled.references].sort((a, b) => a.order - b.order);
        const blobs = sorted.map((ref) => {
          const id = ulid();
          blobForPath.set(ref.path, id);
          return {
            id,
            characterId,
            key: objectKey.characterRef(ownerId, characterId, id),
            ...fileOf(ref.path),
          };
        });
        newCharacters.push({
          id: characterId,
          name: uniqueName(bundled.name, characterNames),
          description: bundled.description,
          referenceSet: sorted.map((ref, order) => ({
            blobId: blobs[order]!.id,
            view: ref.view,
            ...(ref.caption ? { caption: ref.caption } : {}),
            origin: 'uploaded' as const,
            order,
          })),
          blobs,
        });
      } else {
        const id = ulid();
        const ext = extname(slot.bundled.path).slice(1) || 'bin';
        newAssets.push({
          id: r.id,
          name: uniqueName(slot.bundled.name, assetNames),
          kind: slot.assetKind,
          blob: {
            id,
            key: objectKey.asset(ownerId, dto.channelId, id, ext),
            ...fileOf(slot.bundled.path),
          },
        });
      }
    }

    // Swap the placeholders for real ids.
    const idOf = (placeholder: string): string | undefined => {
      const key = slotKeyOf(placeholder);
      const r = key === null ? undefined : resolved.get(key);
      return r && r.use !== 'empty' ? r.id : undefined;
    };
    const graph = mapGraphRefs(pipeline.graph, (ref) =>
      ref.from === 'asset' ? { from: 'asset', assetId: idOf(ref.assetId) ?? ref.assetId } : ref,
    );
    const roles = pipeline.roles.map((role) => {
      const slotKey = role.characterId ? slotKeyOf(role.characterId) : null;
      const slot = manifest.slots.find((s) => s.key === slotKey);
      const characterId = role.characterId ? idOf(role.characterId) : undefined;
      const r = slot ? resolved.get(slot.key) : undefined;
      let selected: string[] = [];
      if (slot?.kind === 'character' && r?.use === 'bundled' && slot.bundled) {
        // The reference images the author's role selected, or all of them.
        const paths = slot.bundled.selected.length
          ? slot.bundled.selected
          : slot.bundled.references.map((ref) => ref.path);
        selected = paths.flatMap((p) => blobForPath.get(p) ?? []);
      } else if (slot?.kind === 'character' && r?.use === 'existing') {
        // A role needs at least one reference: take the importer's character's first few.
        selected = (characterRefs.get(r.id) ?? []).slice(0, slot.referenceCount ?? 1);
      }
      return {
        key: role.key,
        label: role.label,
        required: role.required,
        ...(characterId ? { characterId } : {}),
        ...(characterId && selected.length ? { referenceBlobIds: selected } : {}),
      };
    });

    const { signer } = report;
    const packageId = signer.own ? manifest.package.id : null;
    const packageBasedOn = signer.own
      ? (manifest.basedOn ?? null)
      : { packageId: manifest.package.id, fingerprint: signer.fingerprint ?? 'unsigned' };

    try {
      for (const c of newCharacters) {
        for (const b of c.blobs) {
          await this.storage.put(b.key, Buffer.from(b.bytes), { mime: b.mime });
          written.push(b.key);
        }
      }
      for (const a of newAssets) {
        await this.storage.put(a.blob.key, Buffer.from(a.blob.bytes), { mime: a.blob.mime });
        written.push(a.blob.key);
      }

      const result = await this.db.transaction(async (tx) => {
        let blueprintId: string;
        if (dto.mode === 'new') {
          await this.blueprints.assertNameFree(dto.channelId, dto.name, undefined, tx);
          blueprintId = ulid();
          await tx.insert(blueprint).values({
            id: blueprintId,
            channelId: dto.channelId,
            name: dto.name,
            description: manifest.meta.description || null,
            tags: manifest.meta.tags,
            packageId,
            packageBasedOn,
          });
        } else {
          blueprintId = dto.targetBlueprintId!;
        }

        const blobRow = (b: BlobPlan, scope: 'character' | 'asset', characterId?: string) => ({
          id: b.id,
          ownerId,
          scope,
          characterId: characterId ?? null,
          bucket: this.config.s3.bucket,
          objectKey: b.key,
          mime: b.mime,
          bytes: b.bytes.byteLength,
          sha256: b.sha256,
        });
        for (const c of newCharacters) {
          await tx.insert(character).values({
            id: c.id,
            ownerId,
            channelId: dto.channelId,
            scope: 'channel',
            name: c.name,
            description: c.description,
            referenceSet: c.referenceSet,
            readiness: 'ready',
          });
          await tx.insert(blob).values(c.blobs.map((b) => blobRow(b, 'character', c.id)));
        }
        for (const a of newAssets) {
          await tx.insert(blob).values(blobRow(a.blob, 'asset'));
          await tx.insert(asset).values({
            id: a.id,
            ownerId,
            channelId: dto.channelId,
            name: a.name,
            kind: a.kind,
            blobId: a.blob.id,
          });
        }

        const version = await this.blueprints.createVersion(
          blueprintId,
          {
            graph,
            inputs: pipeline.inputs,
            roles,
            defaults: pipeline.defaults,
            budget: { runCapUsd: dto.runCapUsd },
          },
          { bump, tx, keepWorkingDraft: true },
        );
        await tx.insert(packageImport).values({
          id: ulid(),
          blueprintId,
          blueprintVersionId: version.id,
          packageId: manifest.package.id,
          packageVersion: manifest.package.version,
          contentHash: opened.contentHash,
          authorFingerprint: signer.fingerprint,
          basedOn: manifest.basedOn ?? null,
        });
        return { blueprintId, blueprintVersionId: version.id, runnable: version.runnable };
      });

      if (dto.trustAuthor && signer.signed && !signer.own) {
        await this.identity.trust(manifest.author.publicKey);
      }
      this.logger.log(
        { blueprintId: result.blueprintId, packageId: manifest.package.id, mode: dto.mode },
        'package installed',
      );
      return result;
    } catch (error) {
      // The rows rolled back; the objects written before them did not.
      await queueStorageOrphans(this.db, written, 'package_import_failed').catch(() => undefined);
      throw error;
    }
  }

  /** Works out, for every slot, whether it uses the package's media, one of
   * the importer's own characters or assets, or stays empty. */
  private async resolveSlots(
    slots: PackageSlot[],
    dto: InstallPackageDto,
  ): Promise<{ resolved: Map<string, Resolved>; characterRefs: Map<string, string[]> }> {
    const resolved = new Map<string, Resolved>();
    const unfilled: string[] = [];
    for (const slot of slots) {
      const binding = dto.bindings[slot.key] ?? (slot.bundled ? 'bundled' : undefined);
      if (binding === undefined) {
        if (slot.required) unfilled.push(slot.label);
        else resolved.set(slot.key, { use: 'empty' });
      } else if (binding === 'bundled') {
        if (!slot.bundled) {
          throw new BadRequestException(
            `"${slot.label}" has no media in the package. Pick one of yours.`,
          );
        }
        resolved.set(slot.key, { use: 'bundled', id: ulid() });
      } else {
        resolved.set(slot.key, { use: 'existing', id: binding.existing });
      }
    }
    if (unfilled.length > 0) {
      throw new BadRequestException(`Fill these slots first: ${unfilled.join(', ')}.`);
    }

    const existing = slots.flatMap((slot) => {
      const r = resolved.get(slot.key);
      return r?.use === 'existing' ? [{ slot, id: r.id }] : [];
    });
    const assetIds = existing.filter((e) => e.slot.kind === 'asset').map((e) => e.id);
    const characterIds = existing.filter((e) => e.slot.kind === 'character').map((e) => e.id);
    const [assets, characters] = await Promise.all([
      assetIds.length
        ? this.db
            .select({ id: asset.id, kind: asset.kind })
            .from(asset)
            .where(
              and(
                inArray(asset.id, assetIds),
                eq(asset.channelId, dto.channelId),
                isNull(asset.deletedAt),
              ),
            )
        : [],
      characterIds.length
        ? this.db
            .select({ id: character.id, referenceSet: character.referenceSet })
            .from(character)
            .where(
              and(
                inArray(character.id, characterIds),
                eq(character.channelId, dto.channelId),
                eq(character.scope, 'channel'),
                isNull(character.deletedAt),
              ),
            )
        : [],
    ]);
    const assetKind = new Map(assets.map((a) => [a.id, a.kind]));
    const characterOk = new Set(characters.map((c) => c.id));
    const characterRefs = new Map(
      characters.map((c) => [
        c.id,
        (c.referenceSet as ReferenceImage[])
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((ref) => ref.blobId),
      ]),
    );
    for (const { slot, id } of existing) {
      if (slot.kind === 'asset') {
        if (!assetKind.has(id)) {
          throw new BadRequestException(
            `The asset chosen for "${slot.label}" is not in this channel.`,
          );
        }
        if (assetKind.get(id) !== slot.assetKind) {
          throw new BadRequestException(`"${slot.label}" needs a different kind of asset.`);
        }
      } else if (!characterOk.has(id)) {
        throw new BadRequestException(
          `The character chosen for "${slot.label}" is not in this channel.`,
        );
      }
    }
    return { resolved, characterRefs };
  }
}

/** `name`, or "name (imported)", "name (imported 2)" … not already taken. The
 * chosen name is added to `taken`. */
function uniqueName(name: string, taken: Set<string>): string {
  let candidate = name;
  for (let n = 1; taken.has(candidate); n++) {
    candidate = n === 1 ? `${name} (imported)` : `${name} (imported ${n})`;
  }
  taken.add(candidate);
  return candidate;
}
