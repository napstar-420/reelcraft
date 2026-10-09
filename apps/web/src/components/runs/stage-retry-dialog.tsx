import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type { RetryItems, RetryScope } from '@reelcraft/shared';
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

const SCOPE_COPY: Record<RetryScope, { title: string; description: string }> = {
  dependents: {
    title: 'Re-run',
    description: 'Re-runs this stage and the later stages that use its output.',
  },
  stage: {
    title: 'Re-run only',
    description: 'Re-runs just this stage. Later stages keep their current outputs.',
  },
  downstream: {
    title: 'Re-run from',
    description: 'Re-runs this stage and every stage after it.',
  },
};

const FAILED_ITEMS_COPY = {
  title: 'Retry failed items of',
  description: 'Re-runs only the items that failed. Items that passed keep their outputs.',
};

export function StageRetryDialog({
  runId,
  stageKey,
  stageLabel,
  scope = 'dependents',
  items,
  open,
  onOpenChange,
}: {
  runId: string;
  stageKey: string | null;
  stageLabel?: string | null;
  scope?: RetryScope;
  /** `failed`: re-run only the stage's failed items, instead of the whole stage. */
  items?: RetryItems;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const preview = useQuery({
    queryKey: ['stage-retry-preview', runId, stageKey, scope, items],
    queryFn: () =>
      api.previewStageRetry(runId, stageKey as string, { scope, ...(items && { items }) }),
    enabled: open && Boolean(stageKey),
    retry: false,
  });

  const confirm = useMutation({
    mutationFn: () =>
      api.confirmStageRetry(runId, stageKey as string, {
        previewToken: preview.data!.previewToken,
        scope,
        ...(items && { items }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['run', runId] });
      onOpenChange(false);
    },
  });

  const affectedStageKeys = preview.data
    ? [...new Set(preview.data.affected.map((entry) => entry.stageKey))]
    : [];
  const itemNumbers = (preview.data?.items ?? []).map((entry) => entry.itemIndex + 1);
  const copy = items === 'failed' ? FAILED_ITEMS_COPY : SCOPE_COPY[scope];

  return (
    <Dialog open={open} onOpenChange={(next) => !confirm.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {copy.title} {stageLabel ?? stageKey}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
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
            {items === 'failed' && itemNumbers.length > 0 ? (
              <div>
                <dt className="text-muted-foreground">Items</dt>
                <dd className="font-medium">{itemNumbers.join(', ')}</dd>
              </div>
            ) : null}
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
            Confirm re-run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
