import { Injectable, Module } from '@nestjs/common';
import type { CheckDef } from '@reefcraft/shared';

export interface CheckResult {
  pass: boolean;
  message?: string;
}

/** §9 — empty builtin registry in phase 1. All checks are pure, synchronous,
 * and perform no I/O; the QuickJS sandbox for script checks arrives in
 * phase 2. */
@Injectable()
export class CheckRunner {
  async run(_checks: CheckDef[], _artifact: unknown): Promise<CheckResult[]> {
    return [];
  }
}

@Module({
  providers: [CheckRunner],
  exports: [CheckRunner],
})
export class CheckModule {}
