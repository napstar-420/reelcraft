import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { BlueprintService } from './blueprint.service';
import { BlueprintValidatorService } from './blueprint-validator.service';
import { BlueprintController } from './blueprint.controller';

@Module({
  imports: [DbModule],
  providers: [BlueprintService, BlueprintValidatorService],
  controllers: [BlueprintController],
  exports: [BlueprintService, BlueprintValidatorService],
})
export class BlueprintModule {}
