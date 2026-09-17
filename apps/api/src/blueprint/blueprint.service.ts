import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, max } from 'drizzle-orm';
import type { CreateBlueprintVersionDto } from '@reefcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { asset, blob, blueprint, blueprintVersion } from '../db/schema/index';
import { ulid } from '../common/ulid';
import { BlueprintValidatorService } from './blueprint-validator.service';
import { collectAssetIds } from './collect-asset-refs';
import type { AssetLookup } from './validation-context';

@Injectable()
export class BlueprintService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly validator: BlueprintValidatorService,
  ) {}

  async ensureBlueprint(channelId: string, name: string): Promise<string> {
    const [existing] = await this.db
      .select()
      .from(blueprint)
      .where(and(eq(blueprint.channelId, channelId), eq(blueprint.name, name)))
      .limit(1);
    if (existing) return existing.id;

    const id = ulid();
    await this.db.insert(blueprint).values({ id, channelId, name });
    return id;
  }

  async createVersion(
    blueprintId: string,
    dto: CreateBlueprintVersionDto,
    sourceTemplateId?: string,
  ) {
    const [blueprintRow] = await this.db
      .select({ channelId: blueprint.channelId })
      .from(blueprint)
      .where(eq(blueprint.id, blueprintId))
      .limit(1);
    if (!blueprintRow) throw new Error(`Blueprint ${blueprintId} not found`);

    const assetsById = await this.loadAssetsById(dto.graph);

    const issues = this.validator.validate({
      graph: dto.graph,
      inputs: dto.inputs,
      roles: dto.roles,
      assetsById,
      blueprintChannelId: blueprintRow.channelId,
    });
    const runnable = issues.every((i) => i.severity !== 'error');

    const [row] = await this.db
      .select({ maxVersion: max(blueprintVersion.version) })
      .from(blueprintVersion)
      .where(eq(blueprintVersion.blueprintId, blueprintId));
    const nextVersion = (row?.maxVersion ?? 0) + 1;

    const id = ulid();
    await this.db.transaction(async (tx) => {
      await tx.insert(blueprintVersion).values({
        id,
        blueprintId,
        version: nextVersion,
        graph: dto.graph,
        inputs: dto.inputs,
        roles: dto.roles,
        defaults: dto.defaults,
        budget: dto.budget,
        validation: issues,
        runnable,
        sourceTemplateId,
      });
      // §3.4 — insert blueprint, insert version, THEN update the pointer;
      // current_version_id has no FK in the schema (see db/schema/blueprint.ts).
      await tx.update(blueprint).set({ currentVersionId: id }).where(eq(blueprint.id, blueprintId));
    });

    return this.getVersion(id);
  }

  async getVersion(id: string) {
    const [row] = await this.db
      .select()
      .from(blueprintVersion)
      .where(eq(blueprintVersion.id, id))
      .limit(1);
    if (!row) throw new Error(`BlueprintVersion ${id} not found`);
    return row;
  }

  async listVersions(blueprintId: string) {
    return this.db
      .select()
      .from(blueprintVersion)
      .where(eq(blueprintVersion.blueprintId, blueprintId));
  }

  /** §16.2 — loads every asset referenced by a `{from:'asset'}` ref in the
   * graph, by id, so the (synchronous, DB-free) validator can check
   * existence/channel/kind without touching the database itself. Deliberately
   * NOT scoped to the blueprint's own channel in the query — an asset from a
   * different channel must still resolve to a row (so the validator can
   * distinguish "unknown asset" from "wrong channel" with two separate
   * error messages), it's the validator that rejects the channel mismatch. */
  private async loadAssetsById(
    graph: CreateBlueprintVersionDto['graph'],
  ): Promise<Map<string, AssetLookup>> {
    const assetIds = collectAssetIds(graph);
    if (assetIds.length === 0) return new Map();
    // A soft-deleted asset (`blob.deletedAt`, `AssetService.delete`) must
    // read as "unknown asset" here too — excluded from the map rather than
    // special-cased, so the validator's existing "unknown asset" error
    // covers it for free.
    const rows = await this.db
      .select({ id: asset.id, kind: asset.kind, channelId: asset.channelId })
      .from(asset)
      .innerJoin(blob, eq(asset.blobId, blob.id))
      .where(and(inArray(asset.id, assetIds), isNull(blob.deletedAt)));
    return new Map(rows.map((r) => [r.id, { kind: r.kind, channelId: r.channelId }]));
  }
}
