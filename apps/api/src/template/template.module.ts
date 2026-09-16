import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { BlueprintModule } from '../blueprint/blueprint.module';
import { TemplateSeedService } from './template-seed.service';
import { TemplateService } from './template.service';
import { TemplateController } from './template.controller';

@Module({
  imports: [DbModule, BlueprintModule],
  providers: [TemplateSeedService, TemplateService],
  controllers: [TemplateController],
  exports: [TemplateService],
})
export class TemplateModule {}
