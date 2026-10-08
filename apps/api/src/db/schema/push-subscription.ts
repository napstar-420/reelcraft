import { jsonb, pgTable, text, timestamptz } from './pg-helpers';

/** One browser's Web Push subscription. No foreign key into the channel,
 * blueprint or run graph, so nothing cascades into it. */
export const pushSubscription = pgTable('push_subscription', {
  endpoint: text('endpoint').primaryKey(), // the push service's address for this browser; unique per browser
  recipientId: text('recipient_id').notNull().default('local'), // user whose notifications this browser receives
  p256dh: text('p256dh').notNull(), // the browser's public key, used to encrypt the payload
  auth: text('auth').notNull(), // the browser's auth secret, used to encrypt the payload
  kinds: jsonb('kinds').notNull().default([]), // NotificationKind[] this browser wants as system notifications
  createdAt: timestamptz('created_at').notNull().defaultNow(), // when the browser subscribed
  updatedAt: timestamptz('updated_at').notNull().defaultNow(), // when the subscription or its kinds last changed
});
