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
import { Button, buttonVariants } from '@/components/ui/button';
import { ApprovalReviewSheet } from '@/components/runs/approval-review-sheet';
import { isApprovalStillOpen } from '@/pages/approval-review.logic';
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
  const discarded = upstreamRerun?.plan.discardedStageKeys;
  // The approval sheet only works while the run is parked on that stage.
  const canReview =
    stop?.reason === 'awaiting_approval' &&
    upstreamRerun?.sourceRunId === run.id &&
    isApprovalStillOpen(stop.stageKey, run);
  return (
    <>
      <AlertDialog
        open={actions.executionPlans !== null}
        onOpenChange={(open) => {
          if (!open && !actions.confirmExecution.isPending) actions.setExecutionPlans(null);
        }}
      >
        <AlertDialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Choose which outputs to use</AlertDialogTitle>
            <AlertDialogDescription>
              Some outputs were produced by older definitions or will be replaced. Your run history
              is preserved. Confirm one execution plan below. Costs use previous execution costs as
              an estimate; new work may cost more.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-3">
            {actions.executionPlans?.map((plan) => (
              <div
                key={`${plan.request.mode}-${plan.request.scope}`}
                className="rounded-lg border p-3 text-sm"
              >
                <h3 id={`plan-${plan.request.mode}-${plan.request.scope}`} className="font-medium">
                  {plan.request.mode === 'validate'
                    ? 'Check existing output without regenerating'
                    : plan.request.mode === 'reuse'
                      ? 'Use existing upstream outputs'
                      : plan.request.scope === 'stage'
                        ? 'Apply edits and run through selected stage'
                        : 'Apply edits and rebuild affected descendants'}
                </h3>
                {plan.blockedReason ? (
                  <p className="mt-2 text-destructive">{plan.blockedReason}</p>
                ) : (
                  <>
                    {plan.staleStageKeys.length > 0 && (
                      <p className="mt-2 text-muted-foreground">
                        Older outputs: {plan.staleStageKeys.map(actions.stageLabel).join(', ')}
                      </p>
                    )}
                    {plan.validationStageKeys.length > 0 && (
                      <p className="mt-2 text-muted-foreground">
                        Validation outdated:{' '}
                        {plan.validationStageKeys.map(actions.stageLabel).join(', ')}
                      </p>
                    )}
                    <p className="mt-2">
                      Will run: {plan.runStageKeys.map(actions.stageLabel).join(', ') || 'Nothing'}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      Keep completed outputs:{' '}
                      {plan.reusedStageKeys.map(actions.stageLabel).join(', ') || 'None'}
                    </p>
                    {plan.invalidatedStageKeys.length > 0 && (
                      <p className="mt-1 text-muted-foreground">
                        Mark stale and defer:{' '}
                        {plan.invalidatedStageKeys.map(actions.stageLabel).join(', ')}
                      </p>
                    )}
                    {plan.request.mode === 'validate' ? (
                      <p className="mt-2 text-muted-foreground">
                        Checks use the stored output. QC may incur judge costs; generation will not
                        run.
                      </p>
                    ) : (
                      <p className="mt-2 font-mono">
                        Previous cost for this work: ${plan.estimatedRerunUsd.toFixed(2)} (unrun
                        stages are unpriced)
                      </p>
                    )}
                    <Button
                      type="button"
                      variant={plan.request.mode === 'reuse' ? 'secondary' : 'default'}
                      className="mt-3"
                      aria-describedby={`plan-${plan.request.mode}-${plan.request.scope}`}
                      disabled={
                        actions.confirmExecution.isPending || plan.runStageKeys.length === 0
                      }
                      onClick={() => actions.confirmExecution.mutate(plan)}
                    >
                      {actions.confirmExecution.isPending ? 'Starting…' : 'Confirm this plan'}
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actions.confirmExecution.isPending}>
              Cancel
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={upstreamRerun !== null}
        onOpenChange={(open) => !open && actions.setUpstreamRerun(null)}
      >
        {upstreamRerun && stop && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {discarded?.length
                  ? 'This new run would omit completed work'
                  : `Running “${actions.stageLabel(upstreamRerun.stageKey)}” re-runs an earlier stage`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {discarded?.length ? (
                  <>
                    {describeSeedStop(stop, actions.stageLabel(stop.stageKey))}. The new run would
                    omit: {discarded.map(actions.stageLabel).join(', ')}. Any required upstream
                    stages will also run. Your original run and outputs remain available. Cancel to
                    keep this run selected.
                  </>
                ) : (
                  <>
                    {describeSeedStop(stop, actions.stageLabel(stop.stageKey))}, so its output
                    can&apos;t be reused and it would run again first
                    {canReview ? '. Review it first to build on its output instead.' : '.'}
                  </>
                )}
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
                {discarded?.length
                  ? 'Create new run without that work'
                  : `Run anyway (also re-runs ${actions.stageLabel(stop.stageKey)})`}
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
      <StageAttemptsSheet
        runId={run.id}
        stageKey={attemptsSheetKey}
        stageLabel={attemptsSheetKey && actions.stageLabel(attemptsSheetKey)}
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
