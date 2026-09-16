import { boolean, integer, jsonb, numeric, pgTable, text, timestamptz, uniqueIndex } from './pg-helpers';
import { run } from './run';
import { artifact } from './artifact';

/** §3.8 */
export const stageExecution = pgTable(
  'stage_execution',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => run.id),
    stageKey: text('stage_key').notNull(),
    // pending|running|awaiting_approval|awaiting_input|passed|failed|stale|skipped
    state: text('state').notNull(),
    isIterating: boolean('is_iterating').notNull().default(false),
    itemCount: integer('item_count'),
    attemptCount: integer('attempt_count').notNull().default(0),
    outputArtifactId: text('output_artifact_id').references(() => artifact.id),
    costUsd: numeric('cost_usd', { precision: 12, scale: 4 }).notNull().default('0'),
    generation: integer('generation').notNull().default(0), // UI labelling only (§15.3)
    failure: jsonb('failure'),
    startedAt: timestamptz('started_at'),
    endedAt: timestamptz('ended_at'),
  },
  (t) => [uniqueIndex('stage_execution_run_id_stage_key_uq').on(t.runId, t.stageKey)],
);

export const stageItem = pgTable(
  'stage_item',
  {
    id: text('id').primaryKey(),
    stageExecutionId: text('stage_execution_id')
      .notNull()
      .references(() => stageExecution.id),
    itemIndex: integer('item_index').notNull(),
    state: text('state').notNull(), // pending|running|awaiting_approval|passed|failed|stale
    attemptCount: integer('attempt_count').notNull().default(0),
    outputArtifactId: text('output_artifact_id').references(() => artifact.id),
    costUsd: numeric('cost_usd', { precision: 12, scale: 4 }).notNull().default('0'),
  },
  (t) => [uniqueIndex('stage_item_stage_execution_id_item_index_uq').on(t.stageExecutionId, t.itemIndex)],
);

/**
 * §3.8 — `attempt_no` is monotonic and never reset, including across
 * FAILED -> resume. The retry-limit check and the idempotency key both
 * depend on it; the unique constraint below is cheap insurance against a
 * reset path ever being introduced by accident.
 */
export const stageAttempt = pgTable(
  'stage_attempt',
  {
    id: text('id').primaryKey(),
    stageExecutionId: text('stage_execution_id')
      .notNull()
      .references(() => stageExecution.id),
    stageItemId: text('stage_item_id').references(() => stageItem.id),
    attemptNo: integer('attempt_no').notNull(),
    outcome: text('outcome').notNull(), // §3.8.1
    resolvedInputs: jsonb('resolved_inputs').notNull(), // includes memory versions read (§6.3)
    renderedPrompt: text('rendered_prompt'),
    idempotencyKey: text('idempotency_key'),
    phase: text('phase').notNull().default('created'), // created|reserved|submitting|submitted|settled
    jobHandle: jsonb('job_handle'),
    providerRequestId: text('provider_request_id'),
    rawResponseRef: text('raw_response_ref'),
    artifactId: text('artifact_id').references(() => artifact.id),
    checkResults: jsonb('check_results'),
    qcVerdict: jsonb('qc_verdict'),
    reviewNote: text('review_note'), // human rejection note (§10.5)
    costUsd: numeric('cost_usd', { precision: 12, scale: 4 }).notNull().default('0'),
    actor: text('actor').notNull().default('engine'), // 'engine' | 'user'
    durationMs: integer('duration_ms'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('stage_attempt_execution_item_attempt_uq').on(
      t.stageExecutionId,
      t.stageItemId,
      t.attemptNo,
    ),
  ],
);
