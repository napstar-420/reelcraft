import { pgEnum, pgTable, text, timestamptz, uniqueIndex } from './pg-helpers';
import { channel } from './channel';
import { blob } from './blob';

export const assetKindEnum = pgEnum('asset_kind', [
  'media.image',
  'media.video',
  'media.audio',
  'font',
  'lut',
]);

/** §3.3 — reusable channel material with a lifetime longer than a run. */
export const asset = pgTable(
  'asset',
  {
    id: text('id').primaryKey(), // unique asset identifier
    ownerId: text('owner_id').notNull().default('local'), // account that owns this asset
    channelId: text('channel_id')
      .notNull()
      .references(() => channel.id), // channel this asset belongs to
    name: text('name').notNull(), // asset name, unique within its channel
    kind: assetKindEnum('kind').notNull(),
    blobId: text('blob_id')
      .notNull()
      .references(() => blob.id), // underlying stored file backing this asset
    tags: text('tags').array().notNull().default([]), // freeform labels for search/filtering
    createdAt: timestamptz('created_at').notNull().defaultNow(), // when the asset was created
  },
  (t) => [uniqueIndex('asset_channel_id_name_uq').on(t.channelId, t.name)],
);
