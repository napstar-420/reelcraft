import { defineConfig } from 'drizzle-kit';
import { loadRootEnv } from './src/common/load-dotenv';

loadRootEnv();

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://reelcraft:reelcraft@localhost:5432/reelcraft',
  },
});
