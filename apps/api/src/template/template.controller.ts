import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { TemplateService } from './template.service';

@Controller('templates')
export class TemplateController {
  constructor(private readonly templates: TemplateService) {}

  @Get()
  listBuiltin() {
    return this.templates.listBuiltin();
  }

  @Post(':id/instantiate')
  instantiate(@Param('id') id: string, @Body() body: { channelId: string; runCapUsd: number }) {
    return this.templates.instantiate(id, body.channelId, body.runCapUsd);
  }
}
