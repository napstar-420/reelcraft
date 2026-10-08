import { index, pgTable, text, timestamptz, uniqueIndex } from './pg-helpers';
import { run } from './run';

/** The in-app inbox: one row per thing worth telling a user about a run. Kept
 * server-side (not only pushed) so a closed tab, a second browser or a later
 * login still sees it. Deleted with its run (`deleteRunsCascade`). */
export const notification = pgTable(
  'notification',
  {
    id: text('id').primaryKey(), // unique notification identifier
    recipientId: text('recipient_id').notNull().default('local'), // user this is for; the run's channel owner
    kind: text('kind').notNull(), // NotificationKind: run_started | awaiting_approval | awaiting_input | paused_budget | paused_quota | auto_resumed | failed | completed | cancelled | reminder
    runId: text('run_id')
      .notNull()
      .references(() => run.id), // run this is about
    stageKey: text('stage_key'), // stage the notification is about, if any
    title: text('title').notNull(), // short headline, fixed when the row is written
    body: text('body').notNull(), // one-line detail, fixed when the row is written
    url: text('url').notNull(), // in-app path to open (bell, toast and OS notification share it)
    dedupeKey: text('dedupe_key').notNull(), // makes a replayed step or a retry insert nothing the second time
    readAt: timestamptz('read_at'), // when the user read it, if they have
    createdAt: timestamptz('created_at').notNull().defaultNow(), // when it was recorded
  },
  (t) => [
    uniqueIndex('notification_dedupe_key_uq').on(t.dedupeKey),
    index('notification_recipient_created_idx').on(t.recipientId, t.createdAt),
  ],
);
