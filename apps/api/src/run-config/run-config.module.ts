import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { ConfigResolverService } from './config-resolver.service';

/**
 * Deliberately NOT the same module as `../config` (the §23 env-var module,
 * which is @Global()). This is the §5 config-*layering* resolver — it needs
 * DbModule, and putting DB access behind a global module would let
 * CapabilityModule reach the database without importing DbModule, silently
 * defeating the §1.3 isolation DbModule's own non-global status enforces.
 */
@Module({
  imports: [DbModule],
  providers: [ConfigResolverService],
  exports: [ConfigResolverService],
})
export class RunConfigModule {}
