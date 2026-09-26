import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { Skeleton } from '@/components/ui/skeleton';
import { describeRunActionError } from '@/lib/describe-run-action-error';

export function StageRetryDialog({
  runId,
  stageKey,
  open,
  onOpenChange,
}: {
  runId: string;
  stageKey: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const preview = useQuery({
    queryKey: ['stage-retry-preview', runId, stageKey],
    queryFn: () => api.previewStageRetry(runId, stageKey as string),
    enabled: open && Boolean(stageKey),
    retry: false,
  });

  const confirm = useMutation({
    mutationFn: () =>
      api.confirmStageRetry(runId, stageKey as string, {
        previewToken: preview.data!.previewToken,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['run', runId] });
      onOpenChange(false);
    },
  });

  const affectedStageKeys = preview.data
    ? [...new Set(preview.data.affected.map((entry) => entry.stageKey))]
    : [];

  return (
    <Dialog open={open} onOpenChange={(next) => !confirm.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Retry {stageKey}</DialogTitle>
          <DialogDescription>
            Reruns this stage and invalidates anything downstream that depends on it.
          </DialogDescription>
        </DialogHeader>

        {preview.isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        ) : preview.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not preview this retry</AlertTitle>
            <AlertDescription>
              {describeRunActionError(preview.error, 'The retry preview failed.')}
            </AlertDescription>
          </Alert>
        ) : preview.data ? (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Affected stages</dt>
              <dd className="font-medium">{affectedStageKeys.join(', ') || stageKey}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Already spent</dt>
              <dd className="font-medium">${preview.data.spentUsd.toFixed(4)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Estimated rerun cost</dt>
              <dd className="font-medium">${preview.data.estimatedRerunUsd.toFixed(4)}</dd>
            </div>
          </dl>
        ) : null}

        {confirm.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not confirm retry</AlertTitle>
            <AlertDescription>
              {describeRunActionError(confirm.error, 'The retry could not be confirmed.')}
            </AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={confirm.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!preview.data || confirm.isPending}
            onClick={() => confirm.mutate()}
          >
            {confirm.isPending ? <Loader2 className="animate-spin" /> : null}
            Confirm retry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
