import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { InstantiateTemplateDto, SaveTemplateDto } from '@reelcraft/shared';
import { Owner } from '../common/owner.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TemplateService } from './template.service';

@Controller('templates')
export class TemplateController {
  constructor(private readonly templates: TemplateService) {}

  @Get()
  list(@Owner() ownerId: string) {
    return this.templates.list(ownerId);
  }

  @Post()
  save(
    @Body(new ZodValidationPipe(SaveTemplateDto)) dto: SaveTemplateDto,
    @Owner() ownerId: string,
  ) {
    return this.templates.save(dto, ownerId);
  }

  @Get(':id/versions')
  listVersions(@Param('id') id: string) {
    return this.templates.listVersions(id);
  }

  @Post(':id/instantiate')
  instantiate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(InstantiateTemplateDto)) dto: InstantiateTemplateDto,
  ) {
    return this.templates.instantiate(id, dto.channelId, dto.runCapUsd);
  }
}
