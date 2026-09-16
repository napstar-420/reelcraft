import { jsonb, pgTable, text, timestamptz } from './pg-helpers';

/** §3.1 */
export const channel = pgTable('channel', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().default('local'),
  name: text('name').notNull(),
  theme: jsonb('theme').notNull().default({}),
  defaults: jsonb('defaults').notNull().default({}), // ConfigLayer
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});
