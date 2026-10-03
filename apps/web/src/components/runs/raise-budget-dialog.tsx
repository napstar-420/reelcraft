import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RunDetailDto } from '@reelcraft/shared';
import { Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeRunActionError } from '@/lib/describe-run-action-error';

/** Raises the cap that blocks the run: the run's budget cap, or, when a
 * stage's own Stage cap paused it (`budgetBlock.scope === 'stage'`), that
 * stage's cap for this run. A run paused for budget continues at once. */
export function RaiseBudgetDialog({
  runId,
  currentBudgetCapUsd,
  budgetBlock,
  stageLabel,
  open,
  onOpenChange,
}: {
  runId: string;
  currentBudgetCapUsd: number;
  budgetBlock?: RunDetailDto['budgetBlock'] | undefined;
  stageLabel?: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const stageScope = budgetBlock?.scope === 'stage' ? budgetBlock : null;
  const currentCap = stageScope ? Number(stageScope.stageCapUsd ?? 0) : currentBudgetCapUsd;
  const [capUsd, setCapUsd] = useState(String(currentCap));

  useEffect(() => {
    if (open) setCapUsd(String(currentCap));
  }, [open, currentCap]);

  const raiseBudget = useMutation({
    mutationFn: () => api.raiseRunBudget(runId, Number(capUsd), stageScope?.stageKey),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['run', runId] });
      onOpenChange(false);
    },
  });

  const parsed = Number(capUsd);
  const isValid = Number.isFinite(parsed) && parsed > currentCap;
  const paused = budgetBlock != null;

  return (
    <Dialog open={open} onOpenChange={(next) => !raiseBudget.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{stageScope ? 'Raise stage cap' : 'Raise budget'}</DialogTitle>
          <DialogDescription>
            {stageScope
              ? `The run paused because stage "${stageLabel ?? stageScope.stageKey}" reached its own Stage cap of $${currentCap.toFixed(2)}. Enter a higher cap for this stage in this run.`
              : `Current cap is $${currentBudgetCapUsd.toFixed(2)}. Enter a higher cap.`}
            {paused ? ' The run continues as soon as you raise it.' : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="raise-budget-cap">
            {stageScope ? 'New stage cap (USD)' : 'New budget cap (USD)'}
          </Label>
          <Input
            id="raise-budget-cap"
            type="number"
            min={currentCap}
            step="0.01"
            value={capUsd}
            onChange={(event) => setCapUsd(event.target.value)}
            disabled={raiseBudget.isPending}
          />
        </div>

        {raiseBudget.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not raise budget</AlertTitle>
            <AlertDescription>
              {describeRunActionError(raiseBudget.error, 'The budget could not be raised.')}
            </AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={raiseBudget.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button disabled={!isValid || raiseBudget.isPending} onClick={() => raiseBudget.mutate()}>
            {raiseBudget.isPending ? <Loader2 className="animate-spin" /> : null}
            {paused ? 'Raise and continue' : 'Raise budget'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
