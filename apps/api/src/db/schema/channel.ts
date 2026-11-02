import { boolean, jsonb, pgTable, text, timestamptz } from './pg-helpers';

/** §3.1 */
export const channel = pgTable('channel', {
  id: text('id').primaryKey(), // unique channel identifier
  ownerId: text('owner_id').notNull().default('local'), // account that owns this channel
  name: text('name').notNull(), // display name of the channel
  description: text('description'), // optional human-readable summary of the channel
  theme: jsonb('theme').notNull().default({}), // UI theming/branding config for the channel
  defaults: jsonb('defaults').notNull().default({}), // ConfigLayer: default run config inherited by blueprints/runs in this channel
  archived: boolean('archived').notNull().default(false), // whether the channel is archived/hidden from the default list
  deletedAt: timestamptz('deleted_at'), // when it was moved to the trash; purged for good 30 days later
  createdAt: timestamptz('created_at').notNull().defaultNow(), // when the channel was created
});
