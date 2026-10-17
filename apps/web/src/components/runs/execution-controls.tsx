import type {
  RunDetailDto,
  StageAvailableActions,
  StageRunPlanRequestDto,
} from '@reelcraft/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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

export type StageActionRequest = {
  action: NonNullable<StageRunPlanRequestDto['action']>;
  scope?: StageRunPlanRequestDto['scope'];
  itemIndex?: number;
};
export function StageExecutionControls({
  available,
  busy,
  pending,
  onAction,
  compact = false,
}: {
  available: StageAvailableActions | undefined;
  busy: boolean;
  pending: boolean;
  onAction: (request: StageActionRequest) => void;
  compact?: boolean;
}) {
  if (!available) return null;
  if (busy)
    return available.totalItems !== null ? (
      <span className="text-xs text-muted-foreground tabular-nums">
        {available.completedItems}/{available.totalItems} completed
      </span>
    ) : null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {available.totalItems !== null && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {available.completedItems}/{available.totalItems} completed
        </span>
      )}
      {available.run && (
        <Button
          size={compact ? 'xs' : 'sm'}
          variant="outline"
          disabled={pending}
          onClick={() => onAction({ action: 'run' })}
        >
          Run stage
        </Button>
      )}
      {available.continue && (
        <Button
          size={compact ? 'xs' : 'sm'}
          variant="outline"
          disabled={pending}
          onClick={() => onAction({ action: 'continue' })}
        >
          Continue stage
        </Button>
      )}
      {available.rerun && (!compact || !available.continue) && (
        <Button
          size={compact ? 'xs' : 'sm'}
          variant="outline"
          disabled={pending}
          onClick={() => onAction({ action: 'rerun' })}
        >
          Re-run stage
        </Button>
      )}
      {available.blockedReason && (
        <span className="text-xs text-muted-foreground">{available.blockedReason}</span>
      )}
      {(available.runThrough ||
        available.rebuildDescendants ||
        available.run ||
        available.continue ||
        available.rerun) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size={compact ? 'xs' : 'sm'}
              variant="ghost"
              aria-label="More execution actions"
              disabled={pending}
            >
              …
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {compact && available.rerun && available.continue && (
              <DropdownMenuItem onSelect={() => onAction({ action: 'rerun' })}>
                Re-run stage
              </DropdownMenuItem>
            )}
            {(available.runThrough ?? true) && (
              <DropdownMenuItem onSelect={() => onAction({ action: 'run', scope: 'through' })}>
                Run through stage
              </DropdownMenuItem>
            )}
            {(available.rebuildDescendants ?? true) && (
              <DropdownMenuItem
                onSelect={() => onAction({ action: 'rerun', scope: 'descendants' })}
              >
                Rebuild descendants
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
export function RunExecutionToolbar({
  run,
  actions,
}: {
  run: RunDetailDto;
  actions: RunExecutionActions;
}) {
  const available = run.availableActions;
  if (!available) return null;
  const pending =
    actions.runAll.isPending || actions.confirmExecution.isPending || actions.runStage.isPending;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {available.runBlueprint && (
        <Button size="sm" disabled={pending} onClick={() => actions.runAll.mutate('run')}>
          Run blueprint
        </Button>
      )}
      {available.rerunBlueprint && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => actions.runAll.mutate('rerun')}
        >
          Re-run blueprint
        </Button>
      )}
      {available.pause && (
        <Button
          size="sm"
          variant="outline"
          disabled={actions.pause.isPending}
          onClick={() => actions.pause.mutate()}
        >
          Pause
        </Button>
      )}
      {available.resume && (
        <Button
          size="sm"
          variant="outline"
          disabled={actions.resume.isPending}
          onClick={() => actions.resume.mutate()}
        >
          {run.state === 'CANCELLED' ? 'Continue run' : 'Resume'}
        </Button>
      )}
      {available.cancel && (
        <Button
          size="sm"
          variant="outline"
          disabled={actions.cancel.isPending}
          onClick={() => actions.setConfirmCancel(true)}
        >
          Cancel run
        </Button>
      )}
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Concurrent branches
        <Input
          aria-label="Concurrent branches"
          type="number"
          min={1}
          step={1}
          className="h-8 w-20"
          defaultValue={run.concurrentBranches ?? 2}
          key={`${run.id}-${run.concurrentBranches}`}
          disabled={!available.changeConcurrency || actions.concurrency.isPending}
          onBlur={(event) => {
            const value = event.currentTarget.valueAsNumber;
            if (Number.isSafeInteger(value) && value > 0 && value !== run.concurrentBranches)
              actions.concurrency.mutate(value);
          }}
        />
      </label>
    </div>
  );
}
export function ExecutionPlanDialog({ actions }: { actions: RunExecutionActions }) {
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
            <AlertDialogTitle>Review execution plan</AlertDialogTitle>
            <AlertDialogDescription>
              History and spending are preserved. Re-run regenerates completed work. Costs below are
              estimates from prior attempts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-3">
            {actions.executionPlans?.map((plan) => (
              <div
                key={`${plan.request.mode}-${plan.request.scope}`}
                className="rounded-lg border p-3 text-sm"
              >
                <h3 className="font-medium">
                  {plan.request.itemIndex !== undefined
                    ? `Re-run item ${plan.request.itemIndex + 1} of ${actions.stageLabel(plan.request.stageKey!)}`
                    : plan.request.mode === 'validate'
                      ? 'Check existing output'
                      : plan.request.mode === 'reuse'
                        ? 'Use existing outputs'
                        : plan.request.scope === 'through'
                          ? 'Run through stage'
                          : plan.request.scope === 'descendants'
                            ? plan.request.stageKey
                              ? 'Rebuild descendants'
                              : plan.request.action === 'rerun'
                                ? 'Re-run blueprint'
                                : 'Run blueprint'
                            : 'Apply definition and run selected stage'}
                </h3>
                <p className="mt-2">
                  Will run: {plan.runStageKeys.map(actions.stageLabel).join(', ') || 'Nothing'}
                </p>
                {!!plan.retainedItemCount && (
                  <p>Preserve {plan.retainedItemCount} completed items.</p>
                )}
                {plan.request.action === 'rerun' && (
                  <p>
                    {plan.request.itemIndex !== undefined
                      ? 'Only the selected item will be regenerated.'
                      : 'Completed items in this selection will be regenerated.'}
                  </p>
                )}
                {!!plan.staleStageKeys.length && (
                  <p>
                    Outdated definitions: {plan.staleStageKeys.map(actions.stageLabel).join(', ')}
                  </p>
                )}
                {!!plan.invalidatedStageKeys.length && (
                  <p>
                    Mark stale without running:{' '}
                    {plan.invalidatedStageKeys.map(actions.stageLabel).join(', ')}
                  </p>
                )}
                <p className="mt-2">
                  Previous cost: ${plan.estimatedRerunUsd.toFixed(2)}; unfinished work may cost
                  more.
                </p>
                {plan.blockedReason && (
                  <p className="mt-2 text-destructive">{plan.blockedReason}</p>
                )}
                {!!plan.uncertainAttemptIds?.length && !plan.request.allowUncertainRestart && (
                  <Button
                    className="mt-2"
                    size="sm"
                    variant="outline"
                    disabled={actions.acceptUncertainRestart.isPending}
                    onClick={() => actions.acceptUncertainRestart.mutate(plan)}
                  >
                    I understand possible additional charges; review restart
                  </Button>
                )}
                <Button
                  className="mt-3"
                  size="sm"
                  disabled={
                    !!plan.blockedReason ||
                    actions.confirmExecution.isPending ||
                    !plan.runStageKeys.length
                  }
                  onClick={() => actions.confirmExecution.mutate(plan)}
                >
                  Confirm this plan
                </Button>
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
      <AlertDialog open={actions.confirmCancel} onOpenChange={actions.setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this run?</AlertDialogTitle>
            <AlertDialogDescription>
              Stop execution and preserve completed outputs. You can continue this run later.
              Provider requests already submitted may still incur charges.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep running</AlertDialogCancel>
            <AlertDialogAction
              disabled={actions.cancel.isPending}
              onClick={() => actions.cancel.mutate()}
            >
              Cancel run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
