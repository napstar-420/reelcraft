import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import type { SaveTemplateDto, StageDef, ValidationIssue } from '@reefcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { template, templateVersion } from '../db/schema/index';
import { ulid } from '../common/ulid';
import { BlueprintService } from '../blueprint/blueprint.service';
import { BlueprintValidatorService } from '../blueprint/blueprint-validator.service';
import { SchemaValidatorService } from '../json-schema/schema-validator.service';
import { CapabilityRegistry } from '../capability/capability.registry';

interface TemplateRequires {
  capabilities: string[];
  inputs: unknown[];
}

const EMPTY_REQUIRES: TemplateRequires = { capabilities: [], inputs: [] };

/** §20 — instantiation copies, never references: the template body is
 * inlined into a new blueprint_version, recording source_template_id for
 * provenance. Updating a template later never changes blueprints already
 * made from it. */
@Injectable()
export class TemplateService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly blueprints: BlueprintService,
    private readonly validator: BlueprintValidatorService,
    private readonly schemas: SchemaValidatorService,
    private readonly capabilities: CapabilityRegistry,
  ) {}

  /** Chunk 4 — `kind: 'blueprint'` instantiation is unchanged from phase 1
   * (regression-sensitive): it still creates a real `blueprint_version` and
   * requires `channelId`/`runCapUsd`. `schema`/`check`/`stage` kinds
   * (Locked Decision 2) return the inlined body with no DB write at all —
   * `channelId`/`runCapUsd` are ignored for those. */
  async instantiate(templateId: string, channelId?: string, runCapUsd?: number) {
    const [tmpl] = await this.db
      .select()
      .from(template)
      .where(eq(template.id, templateId))
      .limit(1);
    if (!tmpl) throw new Error(`Template ${templateId} not found`);

    const [latest] = await this.db
      .select()
      .from(templateVersion)
      .where(eq(templateVersion.templateId, templateId))
      .orderBy(desc(templateVersion.version))
      .limit(1);
    if (!latest) throw new Error(`Template ${templateId} has no versions`);

    if (tmpl.kind !== 'blueprint') {
      return { body: latest.body, requires: latest.requires };
    }

    if (!channelId || runCapUsd === undefined) {
      throw new BadRequestException(
        'instantiating a blueprint-kind template requires channelId and runCapUsd',
      );
    }

    const blueprintId = await this.blueprints.ensureBlueprint(channelId, tmpl.name);
    const version = await this.blueprints.createVersion(
      blueprintId,
      {
        graph: latest.body as StageDef[],
        inputs: [],
        roles: [],
        defaults: {},
        budget: { runCapUsd },
      },
      templateId,
    );
    return { ...version, requires: latest.requires };
  }

  /** Replaces `listBuiltin()` — every builtin plus the caller's own `source:
   * 'user'` templates, never another owner's. Each row carries its latest
   * version's `requires` so a caller can warn before instantiating. */
  async list(ownerId: string) {
    const rows = await this.db
      .select()
      .from(template)
      .where(
        or(
          eq(template.source, 'builtin'),
          and(eq(template.source, 'user'), eq(template.ownerId, ownerId)),
        ),
      );
    if (rows.length === 0) return [];

    const versions = await this.db
      .select({
        templateId: templateVersion.templateId,
        requires: templateVersion.requires,
      })
      .from(templateVersion)
      .where(
        inArray(
          templateVersion.templateId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(desc(templateVersion.version));

    const latestRequiresByTemplate = new Map<string, unknown>();
    for (const v of versions) {
      if (!latestRequiresByTemplate.has(v.templateId)) {
        latestRequiresByTemplate.set(v.templateId, v.requires);
      }
    }

    return rows.map((row) => ({
      ...row,
      requires: latestRequiresByTemplate.get(row.id) ?? EMPTY_REQUIRES,
    }));
  }

  async listVersions(templateId: string) {
    return this.db
      .select()
      .from(templateVersion)
      .where(eq(templateVersion.templateId, templateId))
      .orderBy(desc(templateVersion.version));
  }

  /** §20 / Locked Decision 6 — per-kind save validation, scoped to what a
   * template not yet placed in a channel or a graph can actually check.
   * `requires.capabilities` is always server-derived for `blueprint`/`stage`
   * kinds, never trusted from the client. */
  async save(dto: SaveTemplateDto, ownerId: string) {
    const [existing] = await this.db
      .select({ id: template.id })
      .from(template)
      .where(
        and(
          eq(template.ownerId, ownerId),
          eq(template.kind, dto.kind),
          eq(template.name, dto.name),
        ),
      )
      .limit(1);
    if (existing) {
      throw new ConflictException(
        `Template "${dto.name}" of kind "${dto.kind}" already exists for this owner`,
      );
    }

    const { issues, requires } = this.validateForSave(dto);
    if (issues.some((issue) => issue.severity === 'error')) {
      throw new BadRequestException(issues);
    }

    const templateId = ulid();
    const versionId = ulid();
    await this.db.transaction(async (tx) => {
      await tx.insert(template).values({
        id: templateId,
        ownerId,
        source: 'user',
        kind: dto.kind,
        name: dto.name,
        description: dto.description,
        tags: dto.tags,
      });
      await tx.insert(templateVersion).values({
        id: versionId,
        templateId,
        version: 1,
        body: dto.body,
        requires,
      });
    });

    const [created] = await this.db
      .select()
      .from(templateVersion)
      .where(eq(templateVersion.id, versionId))
      .limit(1);
    return { templateId, ...created };
  }

  private validateForSave(dto: SaveTemplateDto): {
    issues: ValidationIssue[];
    requires: TemplateRequires;
  } {
    switch (dto.kind) {
      case 'blueprint': {
        // Channel-agnostic (Locked Decision 6) — `assetsById`/
        // `blueprintChannelId`/`charactersById` default to empty inside
        // `buildValidationContext`, so `{from:'asset'}`/`{from:'role'}` refs
        // surface as expected "unknown" issues, not a save blocker to work
        // around here.
        const issues = this.validator.validate({ graph: dto.body, inputs: [], roles: [] });
        const capabilities = [...new Set(dto.body.map((stage) => stage.capability))];
        return { issues, requires: { capabilities, inputs: dto.requires?.inputs ?? [] } };
      }
      case 'schema': {
        const issues = [
          ...this.schemas.checkDialect(dto.body, 'body'),
          ...this.schemas.checkCompilable(dto.body, 'body'),
        ];
        return { issues, requires: dto.requires ?? EMPTY_REQUIRES };
      }
      case 'check': {
        const issues = this.validator.validateCheckDef(dto.body, 'body');
        return { issues, requires: dto.requires ?? EMPTY_REQUIRES };
      }
      case 'stage': {
        const issues = this.validateStageTemplate(dto.body);
        return {
          issues,
          requires: { capabilities: [dto.body.capability], inputs: dto.requires?.inputs ?? [] },
        };
      }
    }
  }

  /** Locked Decision 6 — a template stage has no graph context yet, so this
   * checks only what's knowable in isolation: the capability exists,
   * `config` matches `configSchema`, and `output.kind` is one of
   * `allowedOutputs(config)`. No ref/binding checks. */
  private validateStageTemplate(stageDef: StageDef): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    let impl;
    try {
      impl = this.capabilities.get(stageDef.capability);
    } catch {
      issues.push({
        path: 'body.capability',
        message: `unknown capability "${stageDef.capability}"`,
        severity: 'error',
      });
      return issues;
    }

    const configViolations = this.schemas.validate(impl.configSchema, stageDef.config);
    for (const v of configViolations) {
      issues.push({ path: `body.config.${v.path}`, message: v.message, severity: 'error' });
    }

    if (!impl.allowedOutputs(stageDef.config).includes(stageDef.output.kind)) {
      issues.push({
        path: 'body.output.kind',
        message: `capability "${stageDef.capability}" does not allow output kind "${stageDef.output.kind}"`,
        severity: 'error',
      });
    }

    return issues;
  }
}
