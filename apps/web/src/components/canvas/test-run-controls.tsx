import { useState } from 'react';
import { Play } from 'lucide-react';
import type {
  CreateBlueprintVersionDto,
  RunDetailDto,
  StageAvailableActions,
} from '@reelcraft/shared';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { RunExecutionToolbar } from '@/components/runs/execution-controls';
import type { RunExecutionActions } from '@/hooks/useRunExecutionActions';
import { RunLaunchDialog } from '@/pages/RunLaunchDialog';
import { launchValuesFromRun } from '@/pages/run-launch.logic';

/** A stage that can't run in this test run because the canvas changed its shape:
 * every stage button is off and the reason says to start a new test run. */
export function withoutStageActions(
  available: StageAvailableActions,
  reason: string,
): StageAvailableActions {
  return {
    ...available,
    run: false,
    continue: false,
    rerun: false,
    runThrough: false,
    rebuildDescendants: false,
    blockedReason: `${reason} Start a new test run.`,
  };
}

/** The canvas toolbar's test-run buttons: Start test run / Pause / Continue, with Stop,
 * Start over and Concurrent branches in the ⋯ menu. Test runs use the canvas as it is,
 * saved or not; the start dialog fills in the last test run's inputs. */
export function TestRunControls({
  channelId,
  draft,
  run,
  actions,
  prepareVersion,
  onLaunched,
}: {
  channelId: string;
  draft: CreateBlueprintVersionDto;
  run: RunDetailDto | undefined;
  actions: RunExecutionActions;
  prepareVersion: () => Promise<string>;
  onLaunched: (runId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <RunExecutionToolbar
        run={run}
        actions={actions}
        newRunReason={actions.newRunReason}
        start={
          <Button size="sm" onClick={() => setOpen(true)} disabled={!channelId}>
            <Play />
            Start test run
          </Button>
        }
        startOver={
          <DropdownMenuItem onSelect={() => setOpen(true)}>Start over (new test run)</DropdownMenuItem>
        }
      />
      <RunLaunchDialog
        key={`${run?.id}-${open}`}
        title="Start test run"
        trigger={null}
        open={open}
        onOpenChange={setOpen}
        channelId={channelId}
        inputs={draft.inputs}
        stages={draft.graph}
        defaultBudgetCapUsd={draft.budget.runCapUsd}
        {...(run && {
          initialValues: launchValuesFromRun(draft.inputs, run.inputs as Record<string, unknown>),
          initialBudgetCapUsd: Number(run.budgetCapUsd),
        })}
        prepareVersion={prepareVersion}
        onLaunched={onLaunched}
      />
    </>
  );
}
