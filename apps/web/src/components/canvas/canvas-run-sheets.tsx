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
import { buttonVariants } from '@/components/ui/button';
import { ApprovalReviewSheet } from '@/components/runs/approval-review-sheet';
import { StageAttemptsSheet } from '@/components/runs/stage-attempts-sheet';
import { StageOutputSheet } from '@/components/runs/stage-output-sheet';
import type { CanvasRunActions } from '@/hooks/useCanvasRunActions';
import { describeSeedStop } from '@/pages/canvas-run.logic';

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
  const { outputSheetKey, attemptsSheetKey, approvalStageKey, upstreamRerun } = actions;
  const stop = upstreamRerun?.plan.stop;
  // The approval sheet only works while the run is parked on that stage.
  const canReview =
    stop?.reason === 'awaiting_approval' &&
    upstreamRerun?.sourceRunId === run.id &&
    run.state === 'PAUSED_APPROVAL' &&
    run.cursorStageKey === stop.stageKey;
  return (
    <>
      <AlertDialog
        open={upstreamRerun !== null}
        onOpenChange={(open) => !open && actions.setUpstreamRerun(null)}
      >
        {upstreamRerun && stop && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Running &ldquo;{actions.stageLabel(upstreamRerun.stageKey)}&rdquo; re-runs an
                earlier stage
              </AlertDialogTitle>
              <AlertDialogDescription>
                {describeSeedStop(stop, actions.stageLabel(stop.stageKey))}, so its output
                can&apos;t be reused and it would run again first
                {canReview ? '. Review it first to build on its output instead.' : '.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              {canReview && (
                <AlertDialogAction
                  className={buttonVariants({ variant: 'default' })}
                  onClick={() => actions.setApprovalStageKey(stop.stageKey)}
                >
                  Review {actions.stageLabel(stop.stageKey)}
                </AlertDialogAction>
              )}
              <AlertDialogAction
                onClick={() =>
                  actions.runStage.mutate({ stageKey: upstreamRerun.stageKey, anyway: true })
                }
              >
                Run anyway (also re-runs {actions.stageLabel(stop.stageKey)})
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
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
