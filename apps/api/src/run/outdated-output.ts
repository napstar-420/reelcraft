import { and, desc, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/drizzle.provider';
import { stageAttempt } from '../db/schema/index';

type Outcome = (typeof stageAttempt.$inferSelect)['outcome'];

/** Attempt outcomes whose artifact became the stage's (or item's) output. */
export const ACCEPTED_OUTCOMES: Outcome[] = ['success', 'user_edit'];

/** Attempt outcomes that end a stage in failure. */
export const FAILED_OUTCOMES: Outcome[] = [
  'check_failed',
  'qc_failed',
  'qc_error',
  'qc_budget_exhausted',
  'provider_error',
  'provider_timeout',
  'infra_error',
];

/**
 * What a run's attempts say about the outputs its stages had. Invalidation resets every stage
 * downstream of a change to `stale` whether it ran or not, and clears its failure, so "out of
 * date" (it had an accepted output) and "failed" (its last attempt failed) are read back here.
 */
export async function loadOutputHistory(
  db: Db,
  executions: Array<{ id: string; state: string }>,
): Promise<{
  acceptedExecutions: Set<string>;
  acceptedItems: Set<string>;
  failedExecutions: Set<string>;
}> {
  const ids = executions.map((e) => e.id);
  const accepted = ids.length
    ? await db
        .select({ executionId: stageAttempt.stageExecutionId, itemId: stageAttempt.stageItemId })
        .from(stageAttempt)
        .where(
          and(
            inArray(stageAttempt.stageExecutionId, ids),
            inArray(stageAttempt.outcome, ACCEPTED_OUTCOMES),
            isNotNull(stageAttempt.artifactId),
          ),
        )
    : [];
  const resetIds = executions.filter((e) => e.state === 'stale').map((e) => e.id);
  const attempts = resetIds.length
    ? await db
        .select({ executionId: stageAttempt.stageExecutionId, outcome: stageAttempt.outcome })
        .from(stageAttempt)
        .where(inArray(stageAttempt.stageExecutionId, resetIds))
        .orderBy(desc(stageAttempt.createdAt))
    : [];
  const last = new Map<string, Outcome>();
  for (const attempt of attempts)
    if (!last.has(attempt.executionId)) last.set(attempt.executionId, attempt.outcome);
  return {
    acceptedExecutions: new Set(accepted.map((a) => a.executionId)),
    acceptedItems: new Set(accepted.flatMap((a) => (a.itemId ? [a.itemId] : []))),
    failedExecutions: new Set(
      [...last].filter(([, outcome]) => FAILED_OUTCOMES.includes(outcome)).map(([id]) => id),
    ),
  };
}
