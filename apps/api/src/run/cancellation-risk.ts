import { sql } from 'drizzle-orm';
import { stageAttempt } from '../db/schema/index';

// Legacy cancelled requests have no cancellation flag; confirmed settlement proves safety.
export function unresolvedCancellation() {
  return sql`(
    ${stageAttempt.cancellationConfirmed} = false or (
      ${stageAttempt.cancellationConfirmed} is null
      and ${stageAttempt.outcome} = 'cancelled'
      and ${stageAttempt.jobHandle} is not null
      and not exists (
        select 1 from ledger_entry settled
        where settled.stage_attempt_id = ${stageAttempt.id}
        and settled.category = 'stage_output'
        and settled.kind in ('release', 'actual') and settled.confirmed = true
      )
    )
  ) and not exists (
    select 1 from stage_attempt newer
    where newer.stage_execution_id = ${stageAttempt.stageExecutionId}
    and coalesce(newer.stage_item_id, '') = coalesce(${stageAttempt.stageItemId}, '')
    and newer.attempt_no > ${stageAttempt.attemptNo}
  )`;
}
