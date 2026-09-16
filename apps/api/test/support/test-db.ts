import path from 'node:path';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as schema from '../../src/db/schema/index';

export interface TestDb {
  db: PostgresJsDatabase<typeof schema>;
  teardown(): Promise<void>;
}

/**
 * Creates a fresh Postgres *database* (not just a schema) on the shared
 * TEST_DATABASE_URL (or DATABASE_URL) server, migrates it, and returns a
 * scoped Drizzle client.
 *
 * A schema-per-suite approach (via `search_path`) was tried first and
 * doesn't work here: `drizzle-kit generate` hardcodes every FK's
 * `REFERENCES` clause to `"public".<table>` (verified — all 25 FKs in
 * `drizzle/0000_daffy_vision.sql`), so a table created in a non-public
 * schema still has its foreign keys point at `public`'s tables regardless
 * of `search_path`. A database-per-suite sidesteps this entirely, since
 * `public` is correct and self-consistent within any single database.
 */
export async function createTestDb(): Promise<TestDb> {
  const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error(
      'createTestDb: set TEST_DATABASE_URL (or DATABASE_URL) to a reachable Postgres instance (docker compose up)',
    );
  }

  const dbName = `test_${randomBytes(8).toString('hex')}`;
  const adminUrl = new URL(baseUrl);
  const testUrl = new URL(baseUrl);
  testUrl.pathname = `/${dbName}`;

  const admin = postgres(adminUrl.toString(), { max: 1 });
  await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const client = postgres(testUrl.toString(), { max: 1 });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../../drizzle') });

  return {
    db,
    async teardown() {
      await client.end();
      const cleanup = postgres(adminUrl.toString(), { max: 1 });
      await cleanup.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
      await cleanup.end();
    },
  };
}
