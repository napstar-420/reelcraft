import { Inject, Injectable } from '@nestjs/common';
import { and, eq, max } from 'drizzle-orm';
import type { CreateBlueprintVersionDto } from '@reefcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { blueprint, blueprintVersion } from '../db/schema/index';
import { ulid } from '../common/ulid';
import { BlueprintValidatorService } from './blueprint-validator.service';

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
    const issues = this.validator.validate({
      graph: dto.graph,
      inputs: dto.inputs,
      roles: dto.roles,
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
}
