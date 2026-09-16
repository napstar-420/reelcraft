import { Injectable, Module } from '@nestjs/common';
import type { QcDef } from '@reefcraft/shared';

export interface QcVerdict {
  score: number;
  critique: string;
}

/** §2.7/§10 — throws if a stage declares qc; QC is out of scope until
 * phase 2. */
@Injectable()
export class QcRunner {
  async run(_qc: QcDef, _artifact: unknown): Promise<QcVerdict> {
    throw new Error('QcRunner: QC is not implemented until phase 2');
  }
}

@Module({
  providers: [QcRunner],
  exports: [QcRunner],
})
export class QcModule {}
