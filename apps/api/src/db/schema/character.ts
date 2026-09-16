import { pgTable, text, jsonb, timestamptz } from './pg-helpers';
import { channel } from './channel';
import { blueprint } from './blueprint';

/** §3.2 */
export const character = pgTable('character', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().default('local'),
  channelId: text('channel_id').references(() => channel.id),
  blueprintId: text('blueprint_id').references(() => blueprint.id),
  scope: text('scope').notNull(), // 'channel' | 'blueprint'
  name: text('name').notNull(),
  description: text('description').notNull(),
  referenceSet: jsonb('reference_set').notNull().default([]), // ReferenceImage[]
  primaryRefId: text('primary_ref_id'),
  lora: jsonb('lora'),
  readiness: text('readiness').notNull().default('draft'), // 'draft' | 'ready'
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});
