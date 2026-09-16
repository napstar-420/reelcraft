import { Module } from '@nestjs/common';
import { ScriptSandboxService } from './script-sandbox.service';

/** Pure sandbox domain — zero imports, mirrors `json-schema/json-schema.module.ts`.
 * `BlueprintModule` (§16.2 script-compiles check) and `CheckModule` (§9.2
 * script evaluation) both depend on this directly, with no DI-isolation
 * risk since it reaches nothing else. */
@Module({
  providers: [ScriptSandboxService],
  exports: [ScriptSandboxService],
})
export class SandboxModule {}
