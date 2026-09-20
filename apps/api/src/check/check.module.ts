import { Module } from '@nestjs/common';
import { JsonSchemaModule } from '../json-schema/json-schema.module';
import { SandboxModule } from '../sandbox/sandbox.module';
import { CheckRunner } from './check-runner.service';
import { TimelineCheckService } from './timeline-check.service';
import { DbModule } from '../db/db.module';
import { CapabilityModule } from '../capability/capability.module';
import { CheckController } from './check.controller';

export type {
  CheckArtifact,
  CheckOutcome,
  CheckResult,
  CheckRunInput,
  BuiltinCheck,
} from './check.types';
export { CheckRunner } from './check-runner.service';
export { BUILTIN_CHECKS } from './builtins/index';

@Module({
  imports: [JsonSchemaModule, SandboxModule, DbModule, CapabilityModule],
  providers: [CheckRunner, TimelineCheckService],
  controllers: [CheckController],
  exports: [CheckRunner, TimelineCheckService],
})
export class CheckModule {}
