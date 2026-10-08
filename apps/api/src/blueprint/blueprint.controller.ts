import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  CreateBlueprintDto,
  CreateBlueprintVersionDto,
  CreateVersionQueryDto,
  SetWorkingDraftDto,
  StartDryRunDto,
  UpdateBlueprintDto,
} from '@reelcraft/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { BlueprintService } from './blueprint.service';
import { RunService } from '../run/run.service';

@Controller('blueprints')
export class BlueprintController {
  constructor(
    private readonly blueprints: BlueprintService,
    private readonly runs: RunService,
  ) {}

  @Post()
  async create(@Body(new ZodValidationPipe(CreateBlueprintDto)) dto: CreateBlueprintDto) {
    const blueprintId = await this.blueprints.createBlueprint(dto.channelId, dto.name, {
      description: dto.description,
      tags: dto.tags,
    });
    return { blueprintId };
  }

  @Get()
  list(@Query('channelId') channelId: string) {
    return this.blueprints.listByChannel(channelId);
  }

  @Get(':id')
  getBlueprint(@Param('id') id: string) {
    return this.blueprints.getBlueprint(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateBlueprintDto)) dto: UpdateBlueprintDto,
  ) {
    return this.blueprints.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.blueprints.delete(id);
  }

  @Post(':id/versions')
  createVersion(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateBlueprintVersionDto)) dto: CreateBlueprintVersionDto,
    @Query(new ZodValidationPipe(CreateVersionQueryDto)) query: CreateVersionQueryDto,
  ) {
    return this.blueprints.createVersion(id, dto, {
      bump: query.bump,
      // `?base=` (empty: no saved version yet) guards against a stale tab; omitted skips it.
      expectedCurrent: query.base === undefined ? undefined : query.base || null,
    });
  }

  /** Canvas runs of unsaved edits — a snapshot that never enters version history. */
  @Post(':id/versions/draft')
  createDraftVersion(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateBlueprintVersionDto)) dto: CreateBlueprintVersionDto,
  ) {
    return this.blueprints.createVersion(id, dto, { draft: true });
  }

  @Put(':id/working-draft')
  setWorkingDraft(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetWorkingDraftDto)) dto: SetWorkingDraftDto,
  ) {
    return this.blueprints.setWorkingDraft(id, dto.workingDraft, dto.baseVersionId);
  }

  @Get(':id/versions')
  listVersions(@Param('id') id: string) {
    return this.blueprints.listVersions(id);
  }

  @Post(':id/validate')
  validate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateBlueprintVersionDto)) dto: CreateBlueprintVersionDto,
  ) {
    return this.blueprints.validateOnly(id, dto);
  }

  /** Chunk 5 — dry-run execution (locked product decision #1): drives a
   * real, fake-provider-forced run through the unchanged async pipeline. */
  @Post(':id/versions/:v/dry-run')
  dryRun(
    @Param('id') id: string,
    @Param('v') v: string,
    @Body(new ZodValidationPipe(StartDryRunDto)) dto: StartDryRunDto,
  ) {
    // `major.minor`; a bare "2" means 2.0.
    const match = /^(\d+)(?:\.(\d+))?$/.exec(v);
    if (!match) throw new BadRequestException(`Invalid version "${v}", expected e.g. 1.5`);
    const version = { major: Number(match[1]), minor: Number(match[2] ?? 0) };
    return this.runs.startDryRun(id, version, dto.budgetCapUsd);
  }
}
