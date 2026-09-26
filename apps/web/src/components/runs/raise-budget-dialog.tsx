import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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

export function RaiseBudgetDialog({
  runId,
  currentBudgetCapUsd,
  open,
  onOpenChange,
}: {
  runId: string;
  currentBudgetCapUsd: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [capUsd, setCapUsd] = useState(String(currentBudgetCapUsd));

  useEffect(() => {
    if (open) setCapUsd(String(currentBudgetCapUsd));
  }, [open, currentBudgetCapUsd]);

  const raiseBudget = useMutation({
    mutationFn: () => api.raiseRunBudget(runId, Number(capUsd)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['run', runId] });
      onOpenChange(false);
    },
  });

  const parsed = Number(capUsd);
  const isValid = Number.isFinite(parsed) && parsed > currentBudgetCapUsd;

  return (
    <Dialog open={open} onOpenChange={(next) => !raiseBudget.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Raise budget</DialogTitle>
          <DialogDescription>
            Current cap is ${currentBudgetCapUsd.toFixed(2)}. Enter a higher cap to unblock this
            run.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="raise-budget-cap">New budget cap (USD)</Label>
          <Input
            id="raise-budget-cap"
            type="number"
            min={currentBudgetCapUsd}
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
            Raise budget
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
