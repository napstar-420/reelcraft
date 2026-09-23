import { pgEnum, pgTable, text, jsonb, timestamptz } from './pg-helpers';
import { channel } from './channel';
import { blueprint } from './blueprint';

export const characterScopeEnum = pgEnum('character_scope', ['channel', 'blueprint']);
export const characterReadinessEnum = pgEnum('character_readiness', ['draft', 'ready']);

/** §3.2 */
export const character = pgTable('character', {
  id: text('id').primaryKey(), // unique character identifier
  ownerId: text('owner_id').notNull().default('local'), // account that owns this character
  channelId: text('channel_id').references(() => channel.id), // channel this character belongs to, when scope is 'channel'
  blueprintId: text('blueprint_id').references(() => blueprint.id), // blueprint this character belongs to, when scope is 'blueprint'
  scope: characterScopeEnum('scope').notNull(), // which of channelId/blueprintId applies
  name: text('name').notNull(), // display name of the character
  description: text('description').notNull(), // description used to guide generation of this character
  referenceSet: jsonb('reference_set').notNull().default([]), // ReferenceImage[]: reference images used to keep the character consistent
  primaryRefId: text('primary_ref_id'), // id of the reference image in referenceSet treated as canonical
  lora: jsonb('lora'), // trained LoRA config/metadata for this character, if any
  readiness: characterReadinessEnum('readiness').notNull().default('draft'), // whether the character is usable in runs
  createdAt: timestamptz('created_at').notNull().defaultNow(), // when the character was created
});
