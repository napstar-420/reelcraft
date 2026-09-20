import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateBlueprintVersionDto } from '@reefcraft/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { BlueprintService } from './blueprint.service';

@Controller('blueprints')
export class BlueprintController {
  constructor(private readonly blueprints: BlueprintService) {}

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
}
