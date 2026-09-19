import { index, jsonb, pgTable, text, timestamptz, uniqueIndex } from './pg-helpers';

/** Provider callbacks are persisted before the runner observes them, so an
 * API restart never loses a completed asynchronous transcription. */
export const providerJob = pgTable(
  'provider_job',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    externalId: text('external_id'),
    callbackToken: text('callback_token').notNull(),
    state: text('state').notNull().default('submitted'),
    payload: jsonb('payload').notNull(),
    result: jsonb('result'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    completedAt: timestamptz('completed_at'),
  },
  (t) => [
    uniqueIndex('provider_job_idempotency_uq').on(t.provider, t.idempotencyKey),
    uniqueIndex('provider_job_callback_token_uq').on(t.callbackToken),
    index('provider_job_external_idx').on(t.provider, t.externalId),
  ],
);
