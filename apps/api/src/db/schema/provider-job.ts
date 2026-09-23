import { index, jsonb, pgEnum, pgTable, text, timestamptz, uniqueIndex } from './pg-helpers';

/** `failed` has no producer yet — reserved so a future terminal-error path
 * doesn't need its own type migration. */
export const providerJobStateEnum = pgEnum('provider_job_state', [
  'submitting',
  'submitted',
  'completed',
  'failed',
]);

/** Provider callbacks are persisted before the runner observes them, so an
 * API restart never loses a completed asynchronous transcription. */
export const providerJob = pgTable(
  'provider_job',
  {
    id: text('id').primaryKey(), // unique provider-job identifier
    provider: text('provider').notNull(), // name of the external provider handling this job
    idempotencyKey: text('idempotency_key').notNull(), // key used to dedupe submissions to the provider
    externalId: text('external_id'), // job id assigned by the external provider
    callbackToken: text('callback_token').notNull(), // secret token used to authenticate the provider's callback
    state: providerJobStateEnum('state').notNull().default('submitted'),
    payload: jsonb('payload').notNull(), // request payload sent to the provider
    result: jsonb('result'), // result payload received from the provider's callback
    createdAt: timestamptz('created_at').notNull().defaultNow(), // when the job was submitted
    completedAt: timestamptz('completed_at'), // when the provider's callback was received
  },
  (t) => [
    uniqueIndex('provider_job_idempotency_uq').on(t.provider, t.idempotencyKey),
    uniqueIndex('provider_job_callback_token_uq').on(t.callbackToken),
    index('provider_job_external_idx').on(t.provider, t.externalId),
  ],
);
