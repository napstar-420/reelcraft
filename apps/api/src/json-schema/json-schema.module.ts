import { Module } from '@nestjs/common';
import { SchemaValidatorService } from './schema-validator.service';

/** Pure schema domain — zero imports. No DB, no capability registry, so any
 * module (`BlueprintModule`, `OrchestrationModule`, and later `CheckModule`/
 * `QcModule`) can depend on it with no DI-isolation risk. */
@Module({
  providers: [SchemaValidatorService],
  exports: [SchemaValidatorService],
})
export class JsonSchemaModule {}
