import type { Provider } from '@nestjs/common';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { EngineConfig } from '../config/engine-config';
import * as schema from './schema/index';

export const DRIZZLE = Symbol('DRIZZLE');
export type Db = PostgresJsDatabase<typeof schema>;
/** The `tx` parameter type `Db['transaction'](async (tx) => ...)` infers —
 * derived rather than imported directly from drizzle-orm's postgres-js
 * transaction class so it always matches `Db`'s own schema generic. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const drizzleProvider: Provider = {
  provide: DRIZZLE,
  inject: [EngineConfig],
  useFactory: (config: EngineConfig): Db => {
    const client = postgres(config.databaseUrl);
    return drizzle(client, { schema });
  },
};
