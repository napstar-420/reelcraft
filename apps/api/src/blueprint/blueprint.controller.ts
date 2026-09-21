import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { CreateBlueprintDto, CreateBlueprintVersionDto, StartDryRunDto } from '@reefcraft/shared';
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
    const blueprintId = await this.blueprints.ensureBlueprint(dto.channelId, dto.name);
    return { blueprintId };
  }

  @Get(':id')
  getBlueprint(@Param('id') id: string) {
    return this.blueprints.getBlueprint(id);
  }

  @Post(':id/versions')
  createVersion(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateBlueprintVersionDto)) dto: CreateBlueprintVersionDto,
  ) {
    return this.blueprints.createVersion(id, dto);
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
