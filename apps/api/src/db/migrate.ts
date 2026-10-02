import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { loadRootEnv } from '../common/load-dotenv';

loadRootEnv();

/** Arbitrary constant shared by every migrator, so two containers (or an
 * updater racing a restart) never apply migrations concurrently. */
const MIGRATION_LOCK_ID = 7_361_534_210;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run migrations');
  }
  // Relative to the working directory (apps/api) unless the image says otherwise.
  const migrationsFolder = process.env.MIGRATIONS_DIR ?? './drizzle';
  const client = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    await client`select pg_advisory_lock(${MIGRATION_LOCK_ID})`;
    await migrate(drizzle(client), { migrationsFolder });
    await client`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`;
  } finally {
    await client.end();
  }
  console.log('Migrations applied.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
