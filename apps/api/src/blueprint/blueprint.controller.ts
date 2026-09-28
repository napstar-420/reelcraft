import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  CreateBlueprintDto,
  CreateBlueprintVersionDto,
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
    const blueprintId = await this.blueprints.ensureBlueprint(dto.channelId, dto.name, {
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

  @Post(':id/versions')
  createVersion(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateBlueprintVersionDto)) dto: CreateBlueprintVersionDto,
  ) {
    return this.blueprints.createVersion(id, dto);
  }

  /** Canvas runs of unsaved edits — a snapshot that never enters version history. */
  @Post(':id/versions/draft')
  createDraftVersion(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateBlueprintVersionDto)) dto: CreateBlueprintVersionDto,
  ) {
    return this.blueprints.createVersion(id, dto, undefined, { draft: true });
  }

  @Put(':id/working-draft')
  setWorkingDraft(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetWorkingDraftDto)) dto: SetWorkingDraftDto,
  ) {
    return this.blueprints.setWorkingDraft(id, dto.workingDraft);
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
    @Param('v', ParseIntPipe) version: number,
    @Body(new ZodValidationPipe(StartDryRunDto)) dto: StartDryRunDto,
  ) {
    return this.runs.startDryRun(id, version, dto.budgetCapUsd);
  }
}
