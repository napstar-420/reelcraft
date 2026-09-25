import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, max } from 'drizzle-orm';
import type { ConfigLayer, CreateBlueprintVersionDto, ValidationIssue } from '@reelcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { asset, blob, blueprint, blueprintVersion, character, channel } from '../db/schema/index';
import { ulid } from '../common/ulid';
import { BlueprintValidatorService } from './blueprint-validator.service';
import { collectAssetIds } from './collect-asset-refs';
import type { AssetLookup, CharacterLookup } from './validation-context';
import { ConfigResolverService } from '../run-config/config-resolver.service';
import { EngineConfig } from '../config/engine-config';
import { engineDefaults } from '../run-config/engine-defaults';
import { ProviderRegistry } from '../provider/provider.registry';
import { modalityForCapability } from '../capability/modality-for-capability';
import type { ModelInfo } from '../provider/provider-adapter.interface';

@Injectable()
export class BlueprintService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly validator: BlueprintValidatorService,
    private readonly configResolver: ConfigResolverService,
    private readonly engineConfig: EngineConfig,
    private readonly providers: ProviderRegistry,
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

  async listByChannel(channelId: string) {
    return this.db.select().from(blueprint).where(eq(blueprint.channelId, channelId));
  }

  async getBlueprint(id: string) {
    const [row] = await this.db.select().from(blueprint).where(eq(blueprint.id, id)).limit(1);
    if (!row) throw new Error(`Blueprint ${id} not found`);
    return row;
  }

  async createVersion(
    blueprintId: string,
    dto: CreateBlueprintVersionDto,
    sourceTemplateId?: string,
  ) {
    const { issues, runnable } = await this.computeValidation(blueprintId, dto);

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

  /** The no-persist half of `createVersion`, extracted so
   * `POST /blueprints/:id/validate` reuses exactly this logic rather than
   * duplicating it. Requires the blueprint to already exist (it needs the
   * blueprint's own `channelId` for asset/character channel-scoping), so a
   * draft graph is always validated against a real blueprint, not a fully
   * hypothetical one. */
  private async computeValidation(
    blueprintId: string,
    dto: CreateBlueprintVersionDto,
  ): Promise<{ issues: ValidationIssue[]; runnable: boolean }> {
    const [blueprintRow] = await this.db
      .select({ channelId: blueprint.channelId, defaults: channel.defaults })
      .from(blueprint)
      .innerJoin(channel, eq(blueprint.channelId, channel.id))
      .where(eq(blueprint.id, blueprintId))
      .limit(1);
    if (!blueprintRow) throw new Error(`Blueprint ${blueprintId} not found`);

    const [assetsById, charactersById] = await Promise.all([
      this.loadAssetsById(dto.graph),
      this.loadCharactersById(dto.roles),
    ]);

    const issues = this.validator.validate({
      graph: dto.graph,
      inputs: dto.inputs,
      roles: dto.roles,
      assetsById,
      blueprintChannelId: blueprintRow.channelId,
      charactersById,
    });
    issues.push(...(await this.validateReferenceLimits(dto, blueprintRow.defaults as ConfigLayer)));
    issues.push(...(await this.validateProviderPins(dto, blueprintRow.defaults as ConfigLayer)));
    const runnable = issues.every((i) => i.severity !== 'error');
    return { issues, runnable };
  }

  async validateOnly(
    blueprintId: string,
    dto: CreateBlueprintVersionDto,
  ): Promise<{ issues: ValidationIssue[]; runnable: boolean }> {
    return this.computeValidation(blueprintId, dto);
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

  /** loads every asset referenced by a `{from:'asset'}` ref in the
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

  private async loadCharactersById(
    roles: CreateBlueprintVersionDto['roles'],
  ): Promise<Map<string, CharacterLookup>> {
    const ids = roles.flatMap((role) => (role.characterId ? [role.characterId] : []));
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({
        id: character.id,
        channelId: character.channelId,
        readiness: character.readiness,
        referenceSet: character.referenceSet,
      })
      .from(character)
      .where(and(inArray(character.id, ids), eq(character.scope, 'channel')));
    return new Map(
      rows.map((row) => [
        row.id,
        {
          channelId: row.channelId ?? '',
          readiness: row.readiness,
          referenceBlobIds: new Set(
            (row.referenceSet as Array<{ blobId: string }>).map((ref) => ref.blobId),
          ),
        },
      ]),
    );
  }

  private async validateProviderPins(
    dto: CreateBlueprintVersionDto,
    channelDefaults: ConfigLayer,
  ): Promise<ValidationIssue[]> {
    const config = this.configResolver.resolveRunConfig({
      graph: dto.graph,
      engine: engineDefaults(this.engineConfig),
      channelDefaults,
      blueprintDefaults: dto.defaults,
    });
    const issues: ValidationIssue[] = [];
    for (const stage of dto.graph) {
      const pin = config[stage.key]?.model;
      if (!pin?.provider) continue;
      const modality = modalityForCapability(stage.capability);
      if (pin.provider === 'openrouter' && stage.output.kind !== 'data') continue;
      if (pin.provider !== 'codex' && pin.provider !== 'openrouter') continue;
      try {
        const model = (await this.providers.get(pin.provider).listModels()).find(
          (candidate) => candidate.modelId === pin.modelId,
        );
        if (pin.provider === 'openrouter') {
          if (!model?.capabilities.supportsStructuredOutput) {
            issues.push({
              path: `stages.${stage.key}.model.modelId`,
              message: `OpenRouter model "${String(pin.modelId)}" does not support structured output`,
              severity: 'error',
            });
          }
          continue;
        }
        const effort = pin.params?.reasoningEffort;
        if (!model) {
          issues.push({
            path: `stages.${stage.key}.model.modelId`,
            message: `Codex model "${String(pin.modelId)}" is not available for the authenticated CLI`,
            severity: 'error',
          });
        } else if (!model.modalities?.includes(modality)) {
          issues.push({
            path: `stages.${stage.key}.model.modelId`,
            message: `Codex model "${model.modelId}" is unavailable for ${modality} stages`,
            severity: 'error',
          });
        } else if (
          typeof effort !== 'string' ||
          !model.supportedReasoningEfforts?.includes(effort)
        ) {
          issues.push({
            path: `stages.${stage.key}.model.params.reasoningEffort`,
            message: `reasoning effort "${String(effort)}" is not supported by Codex model "${model.modelId}"`,
            severity: 'error',
          });
        }
      } catch (error) {
        issues.push({
          path: `stages.${stage.key}.model`,
          message: `${pin.provider === 'codex' ? 'Codex' : 'OpenRouter'} model discovery failed: ${(error as Error).message}`,
          severity: 'error',
        });
      }
    }
    return issues;
  }
  /** Validate the authored selection against the same merged model pins a
   * run will use. This rejects over-limit blueprints at save time instead of
   * letting providers silently drop identity references. */
  private async validateReferenceLimits(
    dto: CreateBlueprintVersionDto,
    channelDefaults: ConfigLayer,
  ): Promise<ValidationIssue[]> {
    const selectedByRole = new Map(
      dto.roles.map((role) => [role.key, role.referenceBlobIds?.length ?? 0]),
    );
    if (selectedByRole.size === 0) return [];
    const config = this.configResolver.resolveRunConfig({
      graph: dto.graph,
      engine: engineDefaults(this.engineConfig),
      channelDefaults,
      blueprintDefaults: dto.defaults,
    });
    const issues: ValidationIssue[] = [];
    for (const stage of dto.graph) {
      const used = Object.values(stage.slots).filter(
        (ref): ref is Extract<(typeof stage.slots)[string], { from: 'role' }> =>
          ref.from === 'role',
      );
      if (used.length === 0) continue;
      const model = config[stage.key]?.model;
      if (!model?.provider || !model.modelId) {
        issues.push({
          path: `stages.${stage.key}`,
          message: 'a role-consuming stage requires a pinned model with a declared reference limit',
          severity: 'error',
        });
        continue;
      }
      let info: ModelInfo | undefined;
      try {
        info = (await this.providers.get(model.provider).listModels()).find(
          (candidate) => candidate.modelId === model.modelId,
        );
      } catch {
        issues.push({
          path: `stages.${stage.key}`,
          message: `unknown provider "${model.provider}" for a role-consuming stage`,
          severity: 'error',
        });
        continue;
      }
      const maxRefs = info?.capabilities.maxRefs ?? info?.capabilities.image?.maxReferences;
      if (!info || maxRefs === undefined) {
        issues.push({
          path: `stages.${stage.key}`,
          message: `model "${model.modelId}" does not declare a reference limit`,
          severity: 'error',
        });
        continue;
      }
      if (
        stage.capability === 'video.generate' &&
        !info.capabilities.video?.inputs.includes('references')
      ) {
        issues.push({
          path: `stages.${stage.key}`,
          message: `model "${model.modelId}" does not support reference-image conditioning`,
          severity: 'error',
        });
        continue;
      }
      for (const ref of used) {
        if ((selectedByRole.get(ref.roleKey) ?? 0) > maxRefs) {
          issues.push({
            path: `roles.${ref.roleKey}.referenceBlobIds`,
            message: `selected references exceed ${model.modelId}'s limit of ${maxRefs}`,
            severity: 'error',
          });
        }
      }
    }
    return issues;
  }
}
