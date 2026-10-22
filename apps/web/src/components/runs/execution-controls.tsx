import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';
import type {
  RunDetailDto,
  StageAvailableActions,
  StageRunPlanRequestDto,
} from '@reelcraft/shared';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import type { RunExecutionActions } from '@/hooks/useRunExecutionActions';
import { primaryRunAction } from '@/lib/run-actions';

export type StageActionRequest = {
  action?: NonNullable<StageRunPlanRequestDto['action']>;
  scope?: StageRunPlanRequestDto['scope'];
  itemIndex?: number;
  recheck?: boolean;
};

/** A stage's run buttons: Run this stage only, plus Run up to this stage, Run from this
 * stage to the end and (test runs, checks-only edits) Re-check output. */
export function StageExecutionControls({
  available,
  busy,
  pending,
  onAction,
  compact = false,
  allowRecheck = false,
}: {
  available: StageAvailableActions | undefined;
  busy: boolean;
  pending: boolean;
  onAction: (request: StageActionRequest) => void;
  compact?: boolean;
  allowRecheck?: boolean;
}) {
  if (!available) return null;
  const progress =
    available.totalItems !== null ? (
      <span className="text-xs text-muted-foreground tabular-nums">
        {available.completedItems}/{available.totalItems} completed
      </span>
    ) : null;
  if (busy) return progress;
  const size = compact ? 'xs' : 'sm';
  const runOnly = available.run || available.continue || available.rerun;
  const scoped = available.runThrough ?? true;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {progress}
      {runOnly && (
        <Button
          size={size}
          variant="outline"
          disabled={pending}
          onClick={() => onAction({ scope: 'stage' })}
        >
          Run this stage only
        </Button>
      )}
      {available.blockedReason && (
        <span className="text-xs text-muted-foreground">{available.blockedReason}</span>
      )}
      {(scoped || (allowRecheck && available.rerun)) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size={size} variant="ghost" aria-label="More stage actions" disabled={pending}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {scoped && (
              <DropdownMenuItem onSelect={() => onAction({ scope: 'through' })}>
                Run up to this stage
              </DropdownMenuItem>
            )}
            {scoped && (
              <DropdownMenuItem onSelect={() => onAction({ scope: 'descendants' })}>
                Run from this stage to the end
              </DropdownMenuItem>
            )}
            {allowRecheck && available.rerun && (
              <DropdownMenuItem onSelect={() => onAction({ scope: 'stage', recheck: true })}>
                Re-check output
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function ConcurrencyInput({ run, actions }: { run: RunDetailDto; actions: RunExecutionActions }) {
  return (
    <label className="flex items-center justify-between gap-3 px-2 py-1.5 text-sm">
      Concurrent branches
      <Input
        aria-label="Concurrent branches"
        type="number"
        min={1}
        step={1}
        className="h-7 w-16"
        defaultValue={run.concurrentBranches ?? 2}
        key={`${run.id}-${run.concurrentBranches}`}
        disabled={!run.availableActions?.changeConcurrency || actions.concurrency.isPending}
        onKeyDown={(event) => event.stopPropagation()}
        onBlur={(event) => {
          const value = event.currentTarget.valueAsNumber;
          if (Number.isSafeInteger(value) && value > 0 && value !== run.concurrentBranches)
            actions.concurrency.mutate(value);
        }}
      />
    </label>
  );
}

/** A run's buttons: one main action for its state (Start / Pause / Continue) and a ⋯ menu
 * with Stop, `menuItems` and Concurrent branches. `start` renders the start button
 * (Start test run on the canvas, Run again on the Run page); `startOver` its menu twin. */
export function RunExecutionToolbar({
  run,
  actions,
  start,
  startOver,
  newRunReason = null,
}: {
  run: RunDetailDto | undefined;
  actions: RunExecutionActions;
  start: ReactNode;
  startOver?: ReactNode;
  newRunReason?: string | null;
}) {
  const primary = primaryRunAction(run);
  const pending = actions.runStage.isPending || actions.confirmExecution.isPending;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {primary === 'start' && start}
      {primary === 'pause' && (
        <Button
          size="sm"
          variant="outline"
          disabled={actions.pause.isPending}
          onClick={() => actions.pause.mutate()}
        >
          Pause
        </Button>
      )}
      {primary === 'continue' && (
        <Button
          size="sm"
          disabled={actions.resume.isPending || pending}
          onClick={() => actions.requestContinue()}
        >
          Continue
        </Button>
      )}
      {run && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" aria-label="More run actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {run.availableActions?.cancel && (
              <DropdownMenuItem onSelect={() => actions.setConfirmCancel(true)}>
                Stop run
              </DropdownMenuItem>
            )}
            {primary !== 'start' && startOver}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="sr-only">Settings</DropdownMenuLabel>
            <ConcurrencyInput run={run} actions={actions} />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {primary === 'continue' && newRunReason && (
        <span
          className="max-w-56 truncate text-xs text-muted-foreground"
          title={`${newRunReason} Continue starts a new run that keeps your finished stages.`}
        >
          Starts a new run, keeping finished stages
        </span>
      )}
    </div>
  );
}

/** Confirms an action that replaces finished work or needs a decision; one plan, one button. */
export function ExecutionPlanDialog({ actions }: { actions: RunExecutionActions }) {
  const plan = actions.executionPlan;
  const names = (keys: string[]) => keys.map(actions.stageLabel).join(', ');
  return (
    <>
      <AlertDialog
        open={plan !== null}
        onOpenChange={(open) => {
          if (!open && !actions.confirmExecution.isPending) actions.setExecutionPlan(null);
        }}
      >
        <AlertDialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {plan?.blockedReason ? 'This can’t run yet' : 'Replace finished work?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {plan?.blockedReason ?? 'Earlier outputs and spending stay in the run’s history.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {plan && !plan.blockedReason && (
            <div className="flex flex-col gap-2 text-sm">
              <p>
                Runs {plan.runStageKeys.length}{' '}
                {plan.runStageKeys.length === 1 ? 'stage' : 'stages'}: {names(plan.runStageKeys)}
              </p>
              {!!plan.outdated?.length && (
                <div className="flex flex-col gap-2 rounded-md border border-amber-500/50 p-3">
                  <p className="text-amber-600 dark:text-amber-400">
                    Out of date, because an earlier stage changed:{' '}
                    {plan.outdated
                      .map(
                        (o) =>
                          `${actions.stageLabel(o.stageKey)}${
                            o.itemIndexes.length
                              ? ` (items ${o.itemIndexes.map((i) => i + 1).join(', ')})`
                              : ''
                          }`,
                      )
                      .join('; ')}
                  </p>
                  <div
                    className="flex flex-col gap-2"
                    role="radiogroup"
                    aria-label="Out-of-date outputs"
                  >
                    {(
                      [
                        [
                          'regenerate',
                          'Regenerate them',
                          'Re-run only the out-of-date items, then continue.',
                        ],
                        [
                          'keep',
                          'Use the outdated outputs',
                          'Keep them as they are and continue from them.',
                        ],
                      ] as const
                    ).map(([choice, label, hint]) => {
                      const selected = (plan.request.outdatedOutputs ?? 'regenerate') === choice;
                      return (
                        <label
                          key={choice}
                          className={cn(
                            'flex cursor-pointer items-start gap-2 rounded-md border p-2',
                            selected ? 'border-primary bg-primary/10' : 'border-border',
                          )}
                        >
                          <input
                            type="radio"
                            name="outdated-outputs"
                            className="mt-1 accent-primary"
                            checked={selected}
                            disabled={actions.chooseOutdated.isPending}
                            onChange={() => actions.chooseOutdated.mutate({ plan, choice })}
                          />
                          <span className="flex flex-col">
                            <span className="font-medium">{label}</span>
                            <span className="text-xs text-muted-foreground">{hint}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
              {!!plan.invalidatedStageKeys.length && (
                <p>Marks stale without running: {names(plan.invalidatedStageKeys)}</p>
              )}
              {!!plan.availabilityChangedStageKeys?.length && (
                <p>Enabled or disabled: {names(plan.availabilityChangedStageKeys)}</p>
              )}
              {!!plan.retainedItemCount && <p>Keeps {plan.retainedItemCount} finished items.</p>}
              <p className="text-muted-foreground">
                Last time these cost ${plan.estimatedRerunUsd.toFixed(2)}.
              </p>
            </div>
          )}
          {plan && !!plan.uncertainAttemptIds?.length && !plan.request.allowUncertainRestart && (
            <Button
              size="sm"
              variant="outline"
              disabled={actions.acceptUncertainRestart.isPending}
              onClick={() => actions.acceptUncertainRestart.mutate(plan)}
            >
              I understand there may be extra charges
            </Button>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actions.confirmExecution.isPending}>
              {plan?.blockedReason ? 'Close' : 'Cancel'}
            </AlertDialogCancel>
            {plan && !plan.blockedReason && (
              <AlertDialogAction
                disabled={actions.confirmExecution.isPending || !plan.runStageKeys.length}
                onClick={(event) => {
                  event.preventDefault();
                  actions.confirmExecution.mutate(plan);
                }}
              >
                Run
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={actions.continueChoice} onOpenChange={actions.setContinueChoice}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Some finished stages are out of date</AlertDialogTitle>
            <AlertDialogDescription>
              {names(actions.outdatedPassedKeys)} changed since they ran. Regenerate them, or keep
              what they made and carry on after them?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm text-muted-foreground">
            Regenerating can cost money again. Keeping starts a new run that copies these results as
            they are; later stages may have been made from the older version.
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actions.resume.isPending}>Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              disabled={actions.resume.isPending}
              onClick={() => actions.resume.mutate(false)}
            >
              Regenerate stale stages
            </Button>
            <Button disabled={actions.resume.isPending} onClick={() => actions.resume.mutate(true)}>
              Keep results and continue
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={actions.confirmCancel} onOpenChange={actions.setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop this run?</AlertDialogTitle>
            <AlertDialogDescription>
              Finished outputs are kept and you can continue later. Requests already sent to a
              provider may still be charged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep running</AlertDialogCancel>
            <AlertDialogAction
              disabled={actions.cancel.isPending}
              onClick={() => actions.cancel.mutate()}
            >
              Stop run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
