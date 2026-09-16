import { Module } from '@nestjs/common';
import { JsonSchemaModule } from '../json-schema/json-schema.module';
import { SandboxModule } from '../sandbox/sandbox.module';
import { CheckRunner } from './check-runner.service';

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
  imports: [JsonSchemaModule, SandboxModule],
  providers: [CheckRunner],
  exports: [CheckRunner],
})
export class CheckModule {}
