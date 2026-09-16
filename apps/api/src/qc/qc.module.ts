import { Module } from '@nestjs/common';
import { ProviderModule } from '../provider/provider.module';
import { QcRunner } from './qc-runner.service';

export type { QcVerdict, QcOutcome } from './qc-runner.service';
export { QcRunner } from './qc-runner.service';
export type { QcEnvelope, QcEnvelopeSource } from './qc-envelope';
export { buildQcEnvelope } from './qc-envelope';

/** §10 — `ProviderModule` has no `DbModule` dependency, so `QcRunner` stays
 * unit-testable against `FakeProviderAdapter` with no DB. */
@Module({
  imports: [ProviderModule],
  providers: [QcRunner],
  exports: [QcRunner],
})
export class QcModule {}
