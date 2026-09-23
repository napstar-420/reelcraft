import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamptz,
  uniqueIndex,
} from './pg-helpers';
import { run } from './run';
import { artifact } from './artifact';

/** §3.8 */
export const stageExecution = pgTable(
  'stage_execution',
  {
    id: text('id').primaryKey(), // unique stage-execution identifier
    runId: text('run_id')
      .notNull()
      .references(() => run.id), // run this stage execution belongs to
    stageKey: text('stage_key').notNull(), // key of the blueprint stage being executed
    // pending|running|awaiting_approval|awaiting_input|passed|failed|stale|skipped
    state: text('state').notNull(), // current lifecycle state of the stage execution
    isIterating: boolean('is_iterating').notNull().default(false), // whether this stage fans out into per-item stage_item rows
    itemCount: integer('item_count'), // number of stage_item rows expected, when iterating
    attemptCount: integer('attempt_count').notNull().default(0), // number of attempts made at the stage level
    outputArtifactId: text('output_artifact_id').references(() => artifact.id), // artifact produced by this stage, when not iterating
    costUsd: numeric('cost_usd', { precision: 12, scale: 4 }).notNull().default('0'), // total cost accrued by this stage execution
    generation: integer('generation').notNull().default(0), // UI labelling only (§15.3)
    failure: jsonb('failure'), // details of the terminal failure, if the stage failed
    startedAt: timestamptz('started_at'), // when the stage execution started running
    endedAt: timestamptz('ended_at'), // when the stage execution reached a terminal state
  },
  (t) => [uniqueIndex('stage_execution_run_id_stage_key_uq').on(t.runId, t.stageKey)],
);

export const stageItem = pgTable(
  'stage_item',
  {
    id: text('id').primaryKey(), // unique stage-item identifier
    stageExecutionId: text('stage_execution_id')
      .notNull()
      .references(() => stageExecution.id), // stage execution this item belongs to
    itemIndex: integer('item_index').notNull(), // position of this item within the iterating stage
    state: text('state').notNull(), // pending|running|awaiting_approval|passed|failed|stale
    attemptCount: integer('attempt_count').notNull().default(0), // number of attempts made for this item
    outputArtifactId: text('output_artifact_id').references(() => artifact.id), // artifact produced for this item
    costUsd: numeric('cost_usd', { precision: 12, scale: 4 }).notNull().default('0'), // total cost accrued by this item
    failure: jsonb('failure'), // mirrors stage_execution.failure (§14)
  },
  (t) => [
    uniqueIndex('stage_item_stage_execution_id_item_index_uq').on(t.stageExecutionId, t.itemIndex),
  ],
);

/**
 * §3.8 — `attempt_no` is monotonic and never reset, including across
 * FAILED -> resume. The retry-limit check and the idempotency key both
 * depend on it; the unique constraint below is cheap insurance against a
 * reset path ever being introduced by accident.
 *
 * The index is keyed on `coalesce(stage_item_id, '')`, not the bare column
 * — Postgres unique indexes treat `NULL <> NULL`, so a plain
 * `(stage_execution_id, stage_item_id, attempt_no)` index (stage_item_id is
 * NULL for every non-iterating stage, i.e. all of phase 2) would let
 * multiple rows share the same `(execution, NULL, attempt_no)` silently.
 * Same fix as `artifact.ts`'s `artifact_active_uq` for the same reason.
 */
export const stageAttempt = pgTable(
  'stage_attempt',
  {
    id: text('id').primaryKey(), // unique stage-attempt identifier
    stageExecutionId: text('stage_execution_id')
      .notNull()
      .references(() => stageExecution.id), // stage execution this attempt belongs to
    stageItemId: text('stage_item_id').references(() => stageItem.id), // stage item this attempt belongs to, when iterating
    attemptNo: integer('attempt_no').notNull(), // monotonic attempt number, never reset (see class comment)
    outcome: text('outcome').notNull(), // §3.8.1
    resolvedInputs: jsonb('resolved_inputs').notNull(), // includes memory versions read (§6.3)
    renderedPrompt: text('rendered_prompt'), // fully rendered prompt sent to the provider
    idempotencyKey: text('idempotency_key'), // key used to dedupe provider submissions on retry
    phase: text('phase').notNull().default('created'), // created|reserved|submitting|submitted|settled
    jobHandle: jsonb('job_handle'), // provider-specific job handle/reference for this attempt
    providerRequestId: text('provider_request_id'), // request id returned by the provider
    rawResponseRef: text('raw_response_ref'), // reference to the raw provider response, for debugging/audit
    artifactId: text('artifact_id').references(() => artifact.id), // artifact produced by this attempt
    checkResults: jsonb('check_results'), // automated check results run against the attempt's output
    qcVerdict: jsonb('qc_verdict'), // quality-control verdict for this attempt
    reviewNote: text('review_note'), // human rejection note (§10.5)
    critiqueTargetStageKey: text('critique_target_stage_key'), // stage key this attempt critiques, when it's a critique attempt
    costUsd: numeric('cost_usd', { precision: 12, scale: 4 }).notNull().default('0'), // cost incurred by this attempt
    actor: text('actor').notNull().default('engine'), // 'engine' | 'user'
    durationMs: integer('duration_ms'), // wall-clock duration of the attempt, in milliseconds
    createdAt: timestamptz('created_at').notNull().defaultNow(), // when the attempt was created
  },
  (t) => [
    uniqueIndex('stage_attempt_execution_item_attempt_uq').on(
      t.stageExecutionId,
      sql`coalesce(${t.stageItemId}, '')`,
      t.attemptNo,
    ),
    index('stage_attempt_artifact_id_idx').on(t.artifactId),
    index('stage_attempt_critique_target_outcome_idx').on(t.critiqueTargetStageKey, t.outcome),
  ],
);
