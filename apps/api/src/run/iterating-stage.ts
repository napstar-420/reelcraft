import { and, eq } from 'drizzle-orm';
import { approvalModeOf, type StageDef } from '@reelcraft/shared';
import type { Db, Tx } from '../db/drizzle.provider';
import { stageExecution, stageItem } from '../db/schema/index';

/** An item of an iterating stage that is reviewed once, at the stage's end,
 * rather than after each item (`approval.mode: 'item'`). */
export function isEndReviewItem(stage: StageDef, ctx: { stageItemId?: string | undefined }) {
  return ctx.stageItemId !== undefined && approvalModeOf(stage) === 'stage';
}

/** Locked Decision 6 — once every item has passed, the stage_execution
 * itself turns 'passed' and its `outputArtifactId` becomes a convenience
 * pointer at the LAST item's artifact (not a sanctioned read path —
 * Run Memory and `{from:'prev', alignWith:'item'}` are). */
export async function finishIteratingStageIn(
  executor: Db | Tx,
  stageExecutionId: string,
): Promise<{ artifactId: string }> {
  const [execution] = await executor
    .select({ itemCount: stageExecution.itemCount })
    .from(stageExecution)
    .where(eq(stageExecution.id, stageExecutionId))
    .limit(1);
  if (!execution || execution.itemCount === null || execution.itemCount === undefined) {
    throw new Error(`finishIteratingStage: stage execution ${stageExecutionId} has no itemCount`);
  }
  if (execution.itemCount === 0) {
    throw new Error(`finishIteratingStage: stage execution ${stageExecutionId} has zero items`);
  }
  const [lastItem] = await executor
    .select({ outputArtifactId: stageItem.outputArtifactId })
    .from(stageItem)
    .where(
      and(
        eq(stageItem.stageExecutionId, stageExecutionId),
        eq(stageItem.itemIndex, execution.itemCount - 1),
      ),
    )
    .limit(1);
  if (!lastItem?.outputArtifactId) {
    throw new Error(
      `finishIteratingStage: last item of ${stageExecutionId} has no outputArtifactId`,
    );
  }
  await executor
    .update(stageExecution)
    .set({
      state: 'passed',
      endedAt: new Date().toISOString(),
      outputArtifactId: lastItem.outputArtifactId,
    })
    .where(eq(stageExecution.id, stageExecutionId));
  return { artifactId: lastItem.outputArtifactId };
}
