import { Module } from '@nestjs/common';
import { drizzleProvider } from './drizzle.provider';

/**
 * Deliberately NOT @Global(). The design spec (§1.3) says both "DbModule
 * (global)" and "CapabilityModule may not inject ... DbModule" — those two
 * statements can't both hold literally, since a @Global() module is visible
 * to every module in the container. Resolving in favor of the isolation
 * rule: modules that need the DRIZZLE token import DbModule explicitly, so
 * CapabilityModule's omission of that import is real DI enforcement,
 * checkable by a standalone-boot test, not a convention that only lint can
 * catch.
 */
@Module({
  providers: [drizzleProvider],
  exports: [drizzleProvider],
})
export class DbModule {}
