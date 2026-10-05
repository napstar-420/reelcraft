import type { RunDetailDto } from '@reelcraft/shared';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
}: {
  run: RunDetailDto | undefined;
  actions: CanvasRunActions;
}) {
  if (!run) return null;
  const running = (stageKey: string | null) =>
    run.stageExecutions.some((e) => e.stageKey === stageKey && e.state === 'running');
  const { outputSheetKey, attemptsSheetKey, approvalStageKey } = actions;
  return (
    <>
      <AlertDialog open={actions.confirmCancel} onOpenChange={actions.setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this run?</AlertDialogTitle>
            <AlertDialogDescription>
              This stops the whole run, not just one stage. It can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep running</AlertDialogCancel>
            <AlertDialogAction onClick={() => actions.cancel.mutate()}>
              Yes, cancel run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <StageOutputSheet
        runId={run.id}
        stageKey={outputSheetKey}
        stageLabel={outputSheetKey && actions.stageLabel(outputSheetKey)}
        stageRunning={running(outputSheetKey)}
        open={outputSheetKey !== null}
        onOpenChange={(open) => !open && actions.setOutputSheetKey(null)}
      />
      <StageAttemptsSheet
        runId={run.id}
        stageKey={attemptsSheetKey}
        stageLabel={attemptsSheetKey && actions.stageLabel(attemptsSheetKey)}
        stageRunning={running(attemptsSheetKey)}
        open={attemptsSheetKey !== null}
        onOpenChange={(open) => !open && actions.setAttemptsSheetKey(null)}
      />
      <ApprovalReviewSheet
        runId={run.id}
        stageKey={approvalStageKey}
        open={approvalStageKey !== null}
        onOpenChange={(open) => !open && actions.setApprovalStageKey(null)}
      />
    </>
  );
}
