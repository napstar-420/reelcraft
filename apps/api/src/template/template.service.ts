import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { StageDef } from '@reefcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { template, templateVersion } from '../db/schema/index';
import { BlueprintService } from '../blueprint/blueprint.service';

/** §20 — instantiation copies, never references: the template body is
 * inlined into a new blueprint_version, recording source_template_id for
 * provenance. Updating a template later never changes blueprints already
 * made from it. */
@Injectable()
export class TemplateService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly blueprints: BlueprintService,
  ) {}

  async instantiate(templateId: string, channelId: string, runCapUsd: number) {
    const [tmpl] = await this.db.select().from(template).where(eq(template.id, templateId)).limit(1);
    if (!tmpl) throw new Error(`Template ${templateId} not found`);

    const [latest] = await this.db
      .select()
      .from(templateVersion)
      .where(eq(templateVersion.templateId, templateId))
      .orderBy(desc(templateVersion.version))
      .limit(1);
    if (!latest) throw new Error(`Template ${templateId} has no versions`);

    const blueprintId = await this.blueprints.ensureBlueprint(channelId, tmpl.name);
    return this.blueprints.createVersion(
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
  }

  async listBuiltin() {
    return this.db.select().from(template).where(and(eq(template.source, 'builtin')));
  }
}
