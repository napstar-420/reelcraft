import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validateEnv } from './env.schema';
import { EngineConfig } from './engine-config';

/**
 * Global by design — it is read-only, validated env, not a database handle.
 * This is unlike DbModule (see db.module.ts), which is deliberately NOT
 * global so CapabilityModule's DI isolation (§1.3) is real enforcement.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: false,
      validate: validateEnv,
    }),
  ],
  providers: [EngineConfig],
  exports: [EngineConfig],
})
export class ConfigModule {}
