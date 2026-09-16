import { pgTable, text, timestamptz, uniqueIndex } from './pg-helpers';
import { channel } from './channel';
import { blob } from './blob';

/** §3.3 — reusable channel material with a lifetime longer than a run. */
export const asset = pgTable(
  'asset',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull().default('local'),
    channelId: text('channel_id')
      .notNull()
      .references(() => channel.id),
    name: text('name').notNull(),
    kind: text('kind').notNull(), // media.image | media.video | media.audio | font | lut
    blobId: text('blob_id')
      .notNull()
      .references(() => blob.id),
    tags: text('tags').array().notNull().default([]),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('asset_channel_id_name_uq').on(t.channelId, t.name)],
);
