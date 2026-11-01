import { ExecutionPlanDialog } from '@/components/runs/execution-controls';
import type { RunDetailDto } from '@reelcraft/shared';

import { ApprovalReviewSheet } from '@/components/runs/approval-review-sheet';
import { StageAttemptsSheet } from '@/components/runs/stage-attempts-sheet';
import { StageOutputSheet } from '@/components/runs/stage-output-sheet';
import type { CanvasRunActions } from '@/hooks/useCanvasRunActions';

/** The sheets and the cancel confirmation the canvas's run actions open.
 * Mounted once on the page so they work from a stage card as well as from the
 * Run tab, whichever tab is showing. */
export function CanvasRunSheets({
  run,
  actions,
  embeddedDetails = false,
}: {
  run: RunDetailDto | undefined;
  actions: CanvasRunActions;
  embeddedDetails?: boolean;
}) {
  if (!run) return null;
  const running = (stageKey: string | null) =>
    run.stageExecutions.some((e) => e.stageKey === stageKey && e.state === 'running');
  const { outputSheetKey, attemptsSheetKey, approvalStageKey } = actions;
  return (
    <>
      <ExecutionPlanDialog actions={actions} />
      {!embeddedDetails && (
        <StageOutputSheet
          actions={run.availableActions?.busy ? undefined : actions}
          runId={run.id}
          stageKey={outputSheetKey}
          stageLabel={outputSheetKey && actions.stageLabel(outputSheetKey)}
          stageRunning={running(outputSheetKey)}
          freshness={
            outputSheetKey && actions.staleStageKeys.has(outputSheetKey)
              ? 'stale'
              : outputSheetKey && actions.validationStageKeys.has(outputSheetKey)
                ? 'validation'
                : undefined
          }
          open={outputSheetKey !== null}
          onOpenChange={(open) => !open && actions.setOutputSheetKey(null)}
        />
      )}
      {!embeddedDetails && (
        <StageAttemptsSheet
          runId={run.id}
          stageKey={attemptsSheetKey}
          stageLabel={attemptsSheetKey && actions.stageLabel(attemptsSheetKey)}
          open={attemptsSheetKey !== null}
          onOpenChange={(open) => !open && actions.setAttemptsSheetKey(null)}
        />
      )}
      <ApprovalReviewSheet
        runId={run.id}
        stageKey={approvalStageKey}
        open={approvalStageKey !== null}
        onOpenChange={(open) => !open && actions.setApprovalStageKey(null)}
        running={run.state === 'RUNNING'}
      />
    </>
  );
}
